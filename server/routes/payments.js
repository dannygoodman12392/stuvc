const express = require('express');
const router = express.Router();
const db = require('../db');
const { requireAuth } = require('../auth');

function getStripe() {
  const key = process.env.STRIPE_SECRET_KEY;
  if (!key) return null;
  return require('stripe')(key);
}

const APP_URL = process.env.APP_URL || 'https://www.stu.vc';
const PRICE_CENTS = 10000; // $100.00

// POST /api/payments/create-checkout-session
router.post('/create-checkout-session', requireAuth, async (req, res) => {
  const stripe = getStripe();
  if (!stripe) return res.status(503).json({ error: 'Payments not configured' });

  // Already paid?
  const user = db.prepare('SELECT has_paid FROM users WHERE id = ?').get(req.user.id);
  if (user?.has_paid) return res.json({ already_paid: true });

  try {
    const session = await stripe.checkout.sessions.create({
      mode: 'payment',
      customer_email: req.user.email,
      line_items: [{
        price_data: {
          currency: 'usd',
          product_data: {
            name: 'Stu — Lifetime Access',
            description: 'AI-powered founder sourcing OS. Pay once, use forever.',
          },
          unit_amount: PRICE_CENTS,
        },
        quantity: 1,
      }],
      metadata: {
        user_id: String(req.user.id),
        user_email: req.user.email,
      },
      success_url: `${APP_URL}/payment/success?session_id={CHECKOUT_SESSION_ID}`,
      cancel_url: `${APP_URL}/payment`,
    });

    res.json({ url: session.url });
  } catch (err) {
    console.error('[Payments] Checkout session error:', err.message);
    res.status(500).json({ error: 'Failed to create checkout session' });
  }
});

// GET /api/payments/status
router.get('/status', requireAuth, (req, res) => {
  const user = db.prepare('SELECT has_paid, payment_date FROM users WHERE id = ?').get(req.user.id);
  res.json({ has_paid: !!user?.has_paid, payment_date: user?.payment_date || null });
});

// Webhook handler — exported separately, mounted with raw body parser
async function webhook(req, res) {
  const stripe = getStripe();
  if (!stripe) return res.status(503).send('Payments not configured');

  const sig = req.headers['stripe-signature'];
  const webhookSecret = process.env.STRIPE_WEBHOOK_SECRET;

  if (!webhookSecret) {
    console.error('[Payments] STRIPE_WEBHOOK_SECRET not set');
    return res.status(500).send('Webhook secret not configured');
  }

  let event;
  try {
    event = stripe.webhooks.constructEvent(req.body, sig, webhookSecret);
  } catch (err) {
    console.error('[Payments] Webhook signature verification failed:', err.message);
    return res.status(400).send(`Webhook Error: ${err.message}`);
  }

  if (event.type === 'checkout.session.completed') {
    const session = event.data.object;
    const userId = session.metadata?.user_id;
    const customerId = session.customer;

    if (userId) {
      db.prepare('UPDATE users SET has_paid = 1, stripe_customer_id = ?, payment_date = CURRENT_TIMESTAMP WHERE id = ?')
        .run(customerId || null, parseInt(userId));
      console.log(`[Payments] User ${userId} payment confirmed (session: ${session.id})`);
    } else {
      console.error('[Payments] Webhook missing user_id in metadata:', session.id);
    }
  }

  res.json({ received: true });
}

module.exports = { router, webhook };
