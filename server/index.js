// Load .env in dev; Railway injects env vars directly in production
// override: true ensures .env values win over empty system env vars (e.g. ANTHROPIC_API_KEY="")
require('dotenv').config({ path: require('path').join(__dirname, '..', '.env'), override: true });

// Railway containers have no IPv6 egress — Google's SMTP/DNS often resolves to IPv6 first,
// causing ENETUNREACH. Force IPv4 globally so all outbound connections stay reachable.
try { require('dns').setDefaultResultOrder('ipv4first'); } catch {}

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

    // One-time sourcing inbox cleanup — drop non-founders, dedupe, re-score caliber.
    // v2 re-runs with the broadened caliber definition (traction / builder evidence,
    // not just credentials) so strong uncredentialed founders are graded up.
    const sourcingCleanupFlag = db.prepare("SELECT * FROM migration_flags WHERE key = 'sourcing_cleanup_v2'").get();
    if (!sourcingCleanupFlag) {
      try {
        console.log('[Migration] Cleaning up sourcing inbox (founder gate + dedupe + broadened caliber)...');
        require('./migrations/cleanup-sourcing-v1')();
        db.prepare("INSERT INTO migration_flags (key) VALUES ('sourcing_cleanup_v2')").run();
      } catch (err) {
        console.error('[Migration] Sourcing cleanup error:', err.message);
      }
    }

    // One-time talent function cleanup — type candidates + remove function-mismatched
    // matches (e.g. engineers under a CMO role).
    const talentFnFlag = db.prepare("SELECT * FROM migration_flags WHERE key = 'talent_function_cleanup_v1'").get();
    if (!talentFnFlag) {
      try {
        console.log('[Migration] Typing candidates by function + clearing mismatched matches...');
        require('./migrations/cleanup-talent-functions')();
        db.prepare("INSERT INTO migration_flags (key) VALUES ('talent_function_cleanup_v1')").run();
      } catch (err) {
        console.error('[Migration] Talent function cleanup error:', err.message);
      }
    }

    // One-time talent role cleanup — derive role function from title/JD (e.g. CMO → gtm)
    // and purge matches that don't fit. Fixes roles stuck on the 'engineering' default.
    const talentRolesFlag = db.prepare("SELECT * FROM migration_flags WHERE key = 'talent_roles_cleanup_v1'").get();
    if (!talentRolesFlag) {
      try {
        console.log('[Migration] Resolving role functions from titles/JDs + clearing mismatched matches...');
        require('./migrations/cleanup-talent-roles')();
        db.prepare("INSERT INTO migration_flags (key) VALUES ('talent_roles_cleanup_v1')").run();
      } catch (err) {
        console.error('[Migration] Talent roles cleanup error:', err.message);
      }
    }

    // One-time sourcing tie cleanup — drop inbox founders with no verified Chicago/IL tie.
    const tieFlag = db.prepare("SELECT * FROM migration_flags WHERE key = 'sourcing_tie_cleanup_v1'").get();
    if (!tieFlag) {
      try {
        console.log('[Migration] Removing inbox founders without a Chicago/IL tie...');
        require('./migrations/cleanup-sourcing-tie')();
        db.prepare("INSERT INTO migration_flags (key) VALUES ('sourcing_tie_cleanup_v1')").run();
      } catch (err) {
        console.error('[Migration] Sourcing tie cleanup error:', err.message);
      }
    }

    // One-time sourcing accuracy cleanup — drop unsupported pedigree tags from the inbox.
    const accFlag = db.prepare("SELECT * FROM migration_flags WHERE key = 'sourcing_accuracy_v1'").get();
    if (!accFlag) {
      try {
        console.log('[Migration] Scrubbing inaccurate pedigree tags from inbox...');
        require('./migrations/cleanup-sourcing-accuracy')();
        db.prepare("INSERT INTO migration_flags (key) VALUES ('sourcing_accuracy_v1')").run();
      } catch (err) {
        console.error('[Migration] Sourcing accuracy cleanup error:', err.message);
      }
    }

    // One-time: flag historical assessments whose decks were corrupted/un-ingested.
    const deckFlag = db.prepare("SELECT * FROM migration_flags WHERE key = 'flag_suspect_decks_v1'").get();
    if (!deckFlag) {
      try {
        console.log('[Migration] Flagging assessments with corrupted/un-ingested decks...');
        require('./migrations/flag-suspect-decks')();
        db.prepare("INSERT INTO migration_flags (key) VALUES ('flag_suspect_decks_v1')").run();
      } catch (err) {
        console.error('[Migration] Suspect-deck flagging error:', err.message);
      }
    }

    // One-time: purge founders admitted without AI verification (credit-outage fallback).
    const unverFlag = db.prepare("SELECT * FROM migration_flags WHERE key = 'cleanup_unverified_sourced_v1'").get();
    if (!unverFlag) {
      try {
        require('./migrations/cleanup-unverified-sourced')();
        db.prepare("INSERT INTO migration_flags (key) VALUES ('cleanup_unverified_sourced_v1')").run();
      } catch (err) { console.error('[Migration] unverified-sourced cleanup error:', err.message); }
    }

    // One-time: replace the Elad whole-book brief row with individual chapters.
    const eladFlag = db.prepare("SELECT * FROM migration_flags WHERE key = 'fix_elad_chapters_v1'").get();
    if (!eladFlag) {
      db.prepare("INSERT INTO migration_flags (key) VALUES ('fix_elad_chapters_v1')").run();
      require('./migrations/fix-elad-chapters')().catch(err => console.error('[fix-elad-chapters] error:', err.message));
    }

    // One-time: sweep inbox to bar — dismiss investors/VCs + founders without a verified tie.
    const pqFlag = db.prepare("SELECT * FROM migration_flags WHERE key = 'cleanup_pipeline_quality_v1'").get();
    if (!pqFlag) {
      try {
        require('./migrations/cleanup-pipeline-quality')();
        db.prepare("INSERT INTO migration_flags (key) VALUES ('cleanup_pipeline_quality_v1')").run();
      } catch (err) { console.error('[Migration] pipeline-quality cleanup error:', err.message); }
    }

    // One-time: backfill sourcing evidence onto already-promoted founders.
    const promoMetaFlag = db.prepare("SELECT * FROM migration_flags WHERE key = 'promote_metadata_backfill_v1'").get();
    if (!promoMetaFlag) {
      try {
        console.log('[Migration] Backfilling sourcing evidence onto promoted founders...');
        require('./migrations/backfill-promote-metadata')();
        db.prepare("INSERT INTO migration_flags (key) VALUES ('promote_metadata_backfill_v1')").run();
      } catch (err) {
        console.error('[Migration] Promote-metadata backfill error:', err.message);
      }
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
app.get('/api/health', (req, res) => res.json({
  status: 'ok', app: 'Stu', version: '4.5.0',
  pipeline: {
    // Armed = the daily sourcing/talent/filings crons will actually run tonight.
    sourcing_armed: process.env.PIPELINE_ENABLED === 'true'
      || (!!process.env.EXA_API_KEY && !!process.env.ANTHROPIC_API_KEY),
    newsletter_armed: true, // ungated — runs for any user with sources/Gmail
    has_exa: !!process.env.EXA_API_KEY,
    has_anthropic: !!process.env.ANTHROPIC_API_KEY,
  },
}));
// Full healthcheck board (authed) — green/red status across datastores, keys, jobs, integrity.
app.get('/api/health/full', requireAuth, (req, res) => {
  try { res.json(require('./services/health').buildHealthReport(req.user.id)); }
  catch (e) { res.status(500).json({ overall: 'red', checks: [{ name: 'Healthcheck', status: 'red', detail: e.message }] }); }
});
// Notion mirror drift check (authed, async). ?repair=1 re-pushes missing founders from canonical SQLite.
app.get('/api/health/drift', requireAuth, async (req, res) => {
  try { res.json(await require('./services/notion-sync').checkNotionDrift(req.user.id, { repair: req.query.repair === '1' })); }
  catch (e) { res.status(500).json({ error: e.message }); }
});
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
app.use('/api/newsletter', requireAuth, require('./routes/newsletter'));
app.use('/api/home', requireAuth, require('./routes/home'));

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

  // Daily newsletter brief — scheduled independently of PIPELINE_ENABLED so the
  // brief is ready each morning for anyone who has connected their Gmail label.
  {
    const cron = require('node-cron');
    cron.schedule('0 6 * * *', async () => {
      console.log('[Cron] Starting daily newsletter brief...');
      try {
        const dbi = require('./db');
        const { fetchAndProcess, fetchAllSources } = require('./services/newsletter');
        // Users with either a managed source (RSS/email) or a legacy Gmail label setup.
        const users = dbi.prepare(`
          SELECT DISTINCT user_id FROM (
            SELECT user_id FROM newsletter_sources WHERE enabled = 1 AND is_deleted = 0
            UNION
            SELECT user_id FROM user_settings WHERE setting_key = 'newsletter_gmail_app_password'
              AND setting_value IS NOT NULL AND setting_value != '' AND setting_value != '""'
          )
        `).all();
        const { backfillAll } = require('./services/brief-archive');
        const { sendDigest } = require('./services/email-digest');
        for (const { user_id } of users) {
          try {
            // 1. Pull the latest newsletter issues.
            const hasSources = dbi.prepare("SELECT COUNT(*) c FROM newsletter_sources WHERE user_id = ? AND enabled = 1 AND is_deleted = 0 AND kind != 'archive'").get(user_id).c > 0;
            const r = hasSources ? await fetchAllSources(user_id) : await fetchAndProcess(user_id, { limit: 40 });
            console.log(`[Cron][Newsletter] user ${user_id}:`, r.ok ? `${r.added} added` : r.error);
            // 2. Keep archive catalogues fresh (idempotent; cheap).
            const hasArchives = dbi.prepare("SELECT COUNT(*) c FROM newsletter_sources WHERE user_id=? AND kind='archive' AND enabled=1 AND is_deleted=0").get(user_id).c > 0;
            if (hasArchives) { try { await backfillAll(user_id); } catch (e) { console.error(`[Cron][Brief] backfill ${user_id}:`, e.message); } }
            // 3. Build + email the digest.
            const sent = await sendDigest(user_id);
            console.log(`[Cron][Brief] user ${user_id}:`, sent.ok ? (sent.skipped ? `skipped (${sent.reason})` : `sent → ${sent.recipient} (${sent.archive} classics, ${sent.newsletters} newsletters)`) : sent.error);
          } catch (e) { console.error(`[Cron][Newsletter] user ${user_id} failed:`, e.message); }
        }
      } catch (e) { console.error('[Cron][Newsletter] run failed:', e.message); }
    }, { timezone: 'America/Chicago' });
    console.log('Daily newsletter brief scheduled (6:00 AM CT)');
  }

  // Daily sourcing cron — runs at 6:00 AM CT (12:00 UTC in CDT / 12:00 UTC in CST).
  // Self-activating: we schedule whenever the pipeline can actually do work — i.e. the
  // keys that power it (Exa for discovery + Anthropic for scoring) are present in the
  // environment — OR when PIPELINE_ENABLED is explicitly set. This removes the silent
  // failure mode where the engine was built and keyed but never ran because a separate
  // flag wasn't flipped in prod.
  const pipelineReady = process.env.PIPELINE_ENABLED === 'true'
    || (!!process.env.EXA_API_KEY && !!process.env.ANTHROPIC_API_KEY);
  if (pipelineReady) {
    console.log(`[Cron] Pipeline active (${process.env.PIPELINE_ENABLED === 'true' ? 'PIPELINE_ENABLED' : 'keys present'})`);
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

    // Daily talent sourcing — source EACH open role against its own function + JD, so
    // marketing/product/CS roles get fresh candidates automatically (not just engineering).
    const { runTalentEngine } = require('./pipeline/talent-engine');
    cron.schedule('30 12 * * *', async () => {
      const dbi = require('./db');
      const roles = dbi.prepare("SELECT id, user_id, title FROM talent_roles WHERE is_deleted = 0 AND status = 'open' ORDER BY user_id, updated_at DESC LIMIT 25").all();
      console.log(`[Cron] Daily talent sourcing across ${roles.length} open role(s)`);
      for (const role of roles) {
        try {
          const r = await runTalentEngine({ userId: role.user_id, roleId: role.id });
          console.log(`[Cron][Talent] role ${role.id} "${role.title}": found ${r.candidatesFound}, added ${r.candidatesAdded}, ${r.matchesCreated} matches`);
        } catch (err) {
          console.error(`[Cron][Talent] role ${role.id} failed:`, err.message);
        }
      }
    });
    console.log('Daily talent sourcing engine scheduled (6:30 AM CT, per open role)');

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
