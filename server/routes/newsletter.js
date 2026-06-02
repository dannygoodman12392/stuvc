const express = require('express');
const router = express.Router();
const db = require('../db');
const { fetchAndProcess, loadNewsletterConfig } = require('../services/newsletter');

// In-memory per-user sync state (running flag + last result).
const syncState = new Map();

function parseItem(row) {
  let key_points = [], matched = [];
  try { key_points = JSON.parse(row.key_points || '[]'); } catch {}
  try { matched = JSON.parse(row.matched_entities || '[]'); } catch {}
  return { ...row, key_points, matched_entities: matched };
}

// GET /api/newsletter/brief?date=YYYY-MM-DD — grouped daily feed
router.get('/brief', (req, res) => {
  const date = req.query.date || db.prepare("SELECT date('now','localtime') AS d").get().d;
  const rows = db.prepare(`
    SELECT * FROM newsletter_items
    WHERE user_id = ? AND brief_date = ? AND is_deleted = 0
    ORDER BY relevance_score DESC, received_at DESC
  `).all(req.user.id, date);

  const items = rows.map(parseItem);
  const groups = { book: [], thesis: [], general: [] };
  for (const it of items) (groups[it.category] || groups.general).push(it);

  // Distinct dates with items, for a simple date switcher.
  const dates = db.prepare(`
    SELECT brief_date, COUNT(*) c FROM newsletter_items
    WHERE user_id = ? AND is_deleted = 0 GROUP BY brief_date ORDER BY brief_date DESC LIMIT 14
  `).all(req.user.id);

  res.json({ date, total: items.length, groups, dates });
});

// GET /api/newsletter/status — configured? running? last sync result?
router.get('/status', (req, res) => {
  const cfg = loadNewsletterConfig(req.user.id);
  res.json({
    configured: !!(cfg.address && cfg.appPassword),
    label: cfg.label,
    address: cfg.address || null,
    ...(syncState.get(req.user.id) || { running: false, last: null }),
  });
});

// POST /api/newsletter/sync — pull the Gmail label, extract, rank (background)
router.post('/sync', (req, res) => {
  const userId = req.user.id;
  const state = syncState.get(userId);
  if (state && state.running) return res.json({ started: false, running: true });

  const cfg = loadNewsletterConfig(userId);
  if (!cfg.address || !cfg.appPassword) {
    return res.status(400).json({ error: 'Add your Gmail address and App Password in Settings first.' });
  }

  syncState.set(userId, { running: true, last: state?.last || null });
  res.json({ started: true });

  // Fire-and-forget; record result in memory for /status.
  fetchAndProcess(userId, { limit: 40 })
    .then(r => {
      syncState.set(userId, {
        running: false,
        last: { at: new Date().toISOString(), ...r },
      });
      console.log(`[Newsletter] sync user ${userId}:`, r.ok ? `${r.added}/${r.fetched} added` : r.error);
    })
    .catch(err => {
      syncState.set(userId, { running: false, last: { at: new Date().toISOString(), ok: false, error: err.message } });
      console.error(`[Newsletter] sync user ${userId} failed:`, err.message);
    });
});

// POST /api/newsletter/:id/read — mark read/unread
router.post('/:id/read', (req, res) => {
  const read = req.body?.read === false ? 0 : 1;
  db.prepare('UPDATE newsletter_items SET is_read = ? WHERE id = ? AND user_id = ?').run(read, req.params.id, req.user.id);
  res.json({ success: true });
});

// DELETE /api/newsletter/:id — dismiss from the brief
router.delete('/:id', (req, res) => {
  db.prepare('UPDATE newsletter_items SET is_deleted = 1 WHERE id = ? AND user_id = ?').run(req.params.id, req.user.id);
  res.json({ success: true });
});

module.exports = router;
