// Load .env in dev; Railway injects env vars directly in production
// override: true ensures .env values win over empty system env vars (e.g. ANTHROPIC_API_KEY="")
require('dotenv').config({ path: require('path').join(__dirname, '..', '.env'), override: true });

const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const rateLimit = require('express-rate-limit');
const path = require('path');
const { requireAuth, seedTeam } = require('./auth');

const app = express();
// Railway injects PORT; fall back to STU_PORT or 3002 for local dev
const PORT = process.env.PORT || process.env.STU_PORT || 3002;

// Seed team on first run
seedTeam();

// Auto-import founder data on first production deploy
const { seedIfEmpty } = require('./seed-production');
seedIfEmpty();

// One-time Airtable migration (idempotent — uses migration_flags table)
(async () => {
  try {
    const db = require('./db');
    db.exec("CREATE TABLE IF NOT EXISTS migration_flags (key TEXT PRIMARY KEY, ran_at DATETIME DEFAULT CURRENT_TIMESTAMP)");
    const flag = db.prepare("SELECT * FROM migration_flags WHERE key = 'airtable_import_v5'").get();
    if (!flag) {
      console.log('[Migration] Running Airtable import v4 (fixed stage mapping)...');
      const runMigration = require('./migrate-from-airtable');
      await runMigration();
      db.prepare("INSERT INTO migration_flags (key) VALUES ('airtable_import_v5')").run();
      console.log('[Migration] Airtable import v4 complete, flag set.');
    } else {
      console.log(`[Migration] Airtable import v4 already ran at ${flag.ran_at}, skipping.`);
    }
    // Backfill Airtable record IDs (idempotent — only sets NULL IDs)
    const backfillFlag = db.prepare("SELECT * FROM migration_flags WHERE key = 'airtable_backfill_ids_v1'").get();
    if (!backfillFlag) {
      console.log('[Migration] Backfilling Airtable record IDs...');
      const backfillIds = require('./backfill-airtable-ids');
      await backfillIds();
      db.prepare("INSERT INTO migration_flags (key) VALUES ('airtable_backfill_ids_v1')").run();
      console.log('[Migration] Airtable ID backfill complete.');
    }
    // Incremental Airtable → Stu sync (runs every startup, imports new founders)
    const { syncFromAirtable } = require('./services/airtable-import');
    syncFromAirtable().catch(err => console.error('[AirtableImport] Startup sync error:', err.message));

    // One-time rubric v3 rescore — fixes v2 (which rescored ALL versions instead of latest per group)
    const rescoreV3Flag = db.prepare("SELECT * FROM migration_flags WHERE key = 'rescore_rubric_v3'").get();
    if (!rescoreV3Flag) {
      console.log('[Migration] Triggering rubric v3 rescore (background)...');
      db.prepare("INSERT INTO migration_flags (key) VALUES ('rescore_rubric_v3')").run();
      const rescoreV3 = require('./migrations/rescore-rubric-v3');
      rescoreV3().catch(err => console.error('[Rescore-v3] Migration error:', err.message));
    }
  } catch (err) {
    console.error('[Migration] Airtable import error:', err.message);
  }
})();

// Security
app.use(helmet({ contentSecurityPolicy: false, crossOriginEmbedderPolicy: false }));

const allowedOrigins = process.env.ALLOWED_ORIGINS
  ? process.env.ALLOWED_ORIGINS.split(',').map(s => s.trim())
  : ['http://localhost:5173', 'http://localhost:5175', 'http://localhost:5176', 'http://localhost:3001'];

// In production, the client is served from the same origin — CORS is permissive for same-origin
// For explicit cross-origin requests, check against allowed list
app.use(cors({
  origin: (origin, cb) => {
    // Same-origin requests (no origin header) or production domain
    if (!origin || allowedOrigins.includes(origin)) return cb(null, true);
    // Allow stu.vc and subdomains only
    if (/^https?:\/\/(.*\.)?stu\.vc$/.test(origin)) return cb(null, true);
    // Allow any localhost port in development
    if (process.env.NODE_ENV !== 'production' && /^http:\/\/localhost:\d+$/.test(origin)) return cb(null, true);
    cb(new Error('Not allowed by CORS'));
  },
  credentials: true
}));

// Stripe webhook needs raw body for signature verification — must be before express.json()
const payments = require('./routes/payments');
app.post('/api/payments/webhook', express.raw({ type: 'application/json' }), payments.webhook);

app.use(express.json({ limit: '50mb' }));

// Rate limiting
app.use('/api', rateLimit({ windowMs: 15 * 60 * 1000, max: 200, standardHeaders: true, legacyHeaders: false }));
app.use('/api/ai', rateLimit({ windowMs: 15 * 60 * 1000, max: 50, standardHeaders: true, legacyHeaders: false }));
app.use('/api/auth/register', rateLimit({ windowMs: 15 * 60 * 1000, max: 5, standardHeaders: true, legacyHeaders: false }));

// Public routes
app.get('/api/health', (req, res) => res.json({ status: 'ok', app: 'Stu', version: '2.1.0' }));
app.use('/api/auth', require('./routes/auth'));
app.use('/api/payments', payments.router);

// Protected routes
app.use('/api/founders', requireAuth, require('./routes/founders'));
app.use('/api/notes', requireAuth, require('./routes/notes'));
app.use('/api/sourcing', requireAuth, require('./routes/sourcing'));
app.use('/api/assessments', requireAuth, require('./routes/assessments'));
app.use('/api/deal-room', requireAuth, require('./routes/dealRoom'));
app.use('/api/calls', requireAuth, require('./routes/calls'));
app.use('/api/ai', requireAuth, require('./routes/ai'));
app.use('/api/stu', requireAuth, require('./routes/stu'));
app.use('/api/memos', requireAuth, require('./routes/memos'));
app.use('/api/files', requireAuth, require('./routes/files'));
app.use('/api/search', requireAuth, require('./routes/search'));
app.use('/api/settings', requireAuth, require('./routes/settings'));
app.use('/api/admin', requireAuth, require('./routes/admin'));
app.use('/api/import', requireAuth, require('./routes/import'));
app.use('/api/talent', requireAuth, require('./routes/talent'));

// Serve static in production
const clientDist = path.join(__dirname, '..', 'client', 'dist');
app.use(express.static(clientDist));
app.get('*', (req, res) => {
  if (!req.path.startsWith('/api')) {
    res.sendFile(path.join(clientDist, 'index.html'));
  }
});

app.listen(PORT, () => {
  console.log(`Stu running on http://localhost:${PORT}`);

  // Daily sourcing cron — runs at 6:00 AM CT (12:00 UTC in CDT / 12:00 UTC in CST)
  if (process.env.PIPELINE_ENABLED === 'true') {
    const cron = require('node-cron');
    const { runSourcingEngine } = require('./pipeline/sourcing-engine');

    cron.schedule('0 12 * * *', async () => {
      console.log('[Cron] Starting daily sourcing run...');
      try {
        const result = await runSourcingEngine();
        console.log(`[Cron] Sourcing complete: ${result.totalAdded} new founders`);
      } catch (err) {
        console.error('[Cron] Sourcing failed:', err.message);
      }
    });

    console.log('Daily sourcing engine scheduled (6:00 AM CT)');

    // Daily talent sourcing — 30 min offset so logs don't interleave
    const { runTalentEngine } = require('./pipeline/talent-engine');
    cron.schedule('30 12 * * *', async () => {
      console.log('[Cron] Starting daily talent sourcing run...');
      try {
        const result = await runTalentEngine({ userId: 1 });
        console.log(`[Cron] Talent sourcing complete:`, result);
      } catch (err) {
        console.error('[Cron] Talent sourcing failed:', err.message);
      }
    });
    console.log('Daily talent sourcing engine scheduled (6:30 AM CT)');

    // R2: Daily SEC Form D IL filings pull — 11 AM UTC (pre-sourcing run so any
    // new filings are available for matching when sourcing runs at 12 UTC).
    const { runFilingsSource } = require('./pipeline/filings-source');
    cron.schedule('0 11 * * *', async () => {
      console.log('[Cron] Starting SEC Form D filings pull...');
      try {
        const result = await runFilingsSource({ userId: 1, days: 30 });
        console.log('[Cron] Filings pull complete:', result);
      } catch (err) {
        console.error('[Cron] Filings pull failed:', err.message);
      }
    });
    console.log('Daily SEC filings pull scheduled (5:00 AM CT)');
  }
});
