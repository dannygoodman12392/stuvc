const express = require('express');
const router = express.Router();
const db = require('../db');
const { VALID_TIE_TYPES } = require('../pipeline/sourcing-engine');

// Hard rule: the Pipeline only ever shows founders with a VERIFIED Chicago/IL tie.
// Two conditions, BOTH required: (1) a canonical tie type, AND (2) actual connection
// evidence text — a founder with a tie type but no substantiating connection (the false
// "Chicago · current" failure mode) is treated as unverified and hidden. Single source of
// truth is the engine's VALID_TIE_TYPES so the display filter can't drift from intake.
const TIE_IN = VALID_TIE_TYPES.map(() => '?').join(',');
const TIE_CLAUSE = `location_type IN (${TIE_IN}) AND chicago_connection IS NOT NULL AND TRIM(chicago_connection) != '' AND LOWER(chicago_connection) NOT LIKE '%no verified tie%' AND LOWER(chicago_connection) != 'any'`;

// School filter: a key from the UI → the substrings that identify that school in the tie text
// (verified tie stores the matched school name) or the headline. Multiple spellings per school.
const SCHOOL_PATTERNS = {
  uchicago: ['uchicago', 'university of chicago', 'booth'],
  northwestern: ['northwestern', 'kellogg'],
  uiuc: ['uiuc', 'university of illinois', 'urbana'],
  iit: ['illinois institute of technology', 'illinois tech'],
  loyola: ['loyola'],
  depaul: ['depaul'],
};

// GET /api/sourcing/queue — pending sourced founders with enhanced data
router.get('/queue', (req, res) => {
  const { sort, source, minScore, search, caliber, tieType, school, scope } = req.query;

  // Scope: 'watchlist' = the national Frontier Watch (non-IL, list_scope='watchlist').
  // Anything else = the Chicago Pipeline (verified IL tie), the default deal flow.
  const params = [req.user.id];
  let where;
  if (String(scope) === 'watchlist') {
    where = `status = 'pending' AND user_id = ? AND list_scope = 'watchlist'`;
  } else {
    where = `status = 'pending' AND user_id = ? AND ${TIE_CLAUSE} AND (list_scope IS NULL OR list_scope = 'pipeline')`;
    params.push(...VALID_TIE_TYPES);
  }

  // Program / source (multi, comma-separated: e.g. yc_directory,a16z_speedrun).
  const sources = String(source || '').split(',').map(s => s.trim()).filter(Boolean);
  if (sources.length) { where += ` AND source IN (${sources.map(() => '?').join(',')})`; params.push(...sources); }

  // Tie type (multi): current / working / school_alumni / hometown / chicago_company.
  const ties = String(tieType || '').split(',').map(s => s.trim()).filter(Boolean);
  if (ties.length) { where += ` AND location_type IN (${ties.map(() => '?').join(',')})`; params.push(...ties); }

  // School: match the school's known spellings against the verified tie text or the headline.
  const pats = SCHOOL_PATTERNS[String(school || '').toLowerCase()];
  if (pats) {
    where += ` AND (${pats.map(() => '(LOWER(chicago_connection) LIKE ? OR LOWER(headline) LIKE ?)').join(' OR ')})`;
    for (const p of pats) params.push(`%${p}%`, `%${p}%`);
  }

  if (minScore) { where += ' AND confidence_score >= ?'; params.push(parseInt(minScore)); }
  // Caliber filter: 'S', 'A', 'B' — or a minimum tier like 'A' meaning S+A.
  if (caliber) {
    const order = { S: 4, A: 3, B: 2, C: 1 };
    const floor = order[String(caliber).toUpperCase()];
    if (floor) {
      const allowed = Object.keys(order).filter(t => order[t] >= floor);
      where += ` AND caliber_tier IN (${allowed.map(() => '?').join(',')})`;
      params.push(...allowed);
    }
  }
  if (search) {
    where += ' AND (name LIKE ? OR company LIKE ? OR headline LIKE ?)';
    params.push(`%${search}%`, `%${search}%`, `%${search}%`);
  }

  // Rank by caliber tier first (S→A→B→C), then fit score. The best-of-best float
  // to the top regardless of how fresh the relevance signal is.
  const caliberRank = `CASE caliber_tier WHEN 'S' THEN 4 WHEN 'A' THEN 3 WHEN 'B' THEN 2 ELSE 1 END`;
  // Default order: caliber first, then affinity to your taste (the learning loop), then fit.
  const sortCol = sort === 'newest'
    ? 'created_at DESC'
    : sort === 'fit'
      ? 'confidence_score DESC, created_at DESC'
      : sort === 'breakout'
        ? 'COALESCE(breakout_score, 0) DESC, created_at DESC'
        : `${caliberRank} DESC, COALESCE(affinity_score,0) DESC, confidence_score DESC, created_at DESC`;
  const founders = db.prepare(`SELECT * FROM sourced_founders WHERE ${where} ORDER BY ${sortCol}`).all(...params);

  // Optional builder-signal filter (e.g. ?signals=just_departed,stealth_building&signalMode=any).
  if (req.query.signals) {
    const { filterBySignals, VALID_SIGNAL_KEYS } = require('../lib/builderSignals');
    const types = String(req.query.signals).split(',').map(s => s.trim()).filter(k => VALID_SIGNAL_KEYS.includes(k));
    if (types.length) {
      const mode = req.query.signalMode === 'all' ? 'all' : 'any';
      const filtered = filterBySignals(founders, { types, source: 'sourcing', mode });
      return res.json(filtered.map(({ row, signals }) => ({ ...row, matched_signals: signals })));
    }
  }
  res.json(founders);
});

// GET /api/sourcing/starred — starred for later review
router.get('/starred', (req, res) => {
  const founders = db.prepare(`SELECT * FROM sourced_founders WHERE status = 'starred' AND user_id = ? AND ${TIE_CLAUSE} ORDER BY confidence_score DESC`).all(req.user.id, ...VALID_TIE_TYPES);
  res.json(founders);
});

// GET /api/sourcing/runs — sourcing run history
router.get('/runs', (req, res) => {
  const runs = db.prepare('SELECT * FROM sourcing_runs WHERE user_id = ? ORDER BY run_at DESC LIMIT 20').all(req.user.id);
  res.json(runs);
});

// POST /api/sourcing/approve/:id — promote to admissions pipeline.
// Atomic: the INSERT (founders) and the UPDATE (sourced_founders) happen in ONE
// transaction, with a status re-check inside the tx, so a crash or a double-click can
// never create a duplicate or an orphan. Carries the FULL sourcing evidence forward.
router.post('/approve/:id', (req, res) => {
  let tags = [], pedigreeSignals = [], builderSignals = [];
  const parse = (s) => { try { const v = JSON.parse(s || '[]'); return Array.isArray(v) ? v : []; } catch { return []; } };
  const userId = req.user.id;
  const sourcedId = req.params.id;

  const insertFounder = db.prepare(`
    INSERT INTO founders (
      name, company, role, email, linkedin_url, github_url, website_url,
      source, fit_score, fit_score_rationale, chicago_connection,
      location_city, stage, domain, tags,
      status, pipeline_tracks, admissions_status,
      company_one_liner, notable_background, previous_companies,
      caliber_tier, caliber_score, caliber_signals, evidence_map, red_flags, sourced_from_id,
      created_by
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);

  let founder;
  try {
    const tx = db.transaction(() => {
      // Re-read + lock the row inside the tx; bail if already processed (idempotent).
      const sourced = db.prepare("SELECT * FROM sourced_founders WHERE id = ? AND user_id = ? AND status IN ('pending','starred')").get(sourcedId, userId);
      if (!sourced) { const e = new Error('not_found'); e.code = 'NOT_FOUND'; throw e; }

      tags = parse(sourced.tags);
      pedigreeSignals = parse(sourced.pedigree_signals);
      builderSignals = parse(sourced.builder_signals);

      const result = insertFounder.run(
        sourced.name, sourced.company || null, sourced.role || 'Founder', sourced.email || null,
        sourced.linkedin_url || null, sourced.github_url || null, sourced.website_url || null,
        sourced.source || 'sourcing-engine', sourced.confidence_score, sourced.confidence_rationale,
        sourced.chicago_connection || null, sourced.location_city || null, 'Pre-seed',
        tags.find(t => ['AI/ML', 'Fintech', 'Healthtech', 'SaaS', 'Defense', 'Climate', 'DevTools', 'Biotech', 'Proptech', 'Edtech', 'Cybersecurity'].includes(t)) || null,
        JSON.stringify(tags), 'Sourced', 'admissions', 'Sourced',
        sourced.company_one_liner || null,
        pedigreeSignals.length ? pedigreeSignals.join(', ') : null,
        builderSignals.length ? builderSignals.join(', ') : null,
        sourced.caliber_tier || null,
        sourced.caliber_score != null ? sourced.caliber_score : null,
        sourced.caliber_signals || null,   // already JSON in sourced_founders
        sourced.evidence_map || null,
        sourced.red_flags || null,
        sourced.id,
        userId
      );
      db.prepare('UPDATE sourced_founders SET status = ?, promoted_to_founder_id = ? WHERE id = ? AND user_id = ?')
        .run('approved', result.lastInsertRowid, sourcedId, userId);
      return result.lastInsertRowid;
    });
    const newId = tx();
    founder = db.prepare('SELECT * FROM founders WHERE id = ?').get(newId);
  } catch (err) {
    if (err.code === 'NOT_FOUND') return res.status(404).json({ error: 'Sourced founder not found or already processed' });
    console.error('[Sourcing] approve failed:', err.message);
    return res.status(500).json({ error: 'Approve failed: ' + err.message });
  }

  // Airtable is NOT written here (team base = explicit publish-to-team only).
  res.json(founder);
});

// POST /api/sourcing/dismiss/:id
router.post('/dismiss/:id', (req, res) => {
  const sourced = db.prepare("SELECT * FROM sourced_founders WHERE id = ? AND user_id = ? AND status IN ('pending', 'starred')").get(req.params.id, req.user.id);
  if (!sourced) return res.status(404).json({ error: 'Sourced founder not found or already processed' });

  db.prepare('UPDATE sourced_founders SET status = ? WHERE id = ? AND user_id = ?').run('dismissed', req.params.id, req.user.id);
  res.json({ message: 'Dismissed' });
});

// R7: POST /api/sourcing/hide-forever/:id — dismiss AND mark do_not_resurface=1
router.post('/hide-forever/:id', (req, res) => {
  const sourced = db.prepare("SELECT * FROM sourced_founders WHERE id = ? AND user_id = ?").get(req.params.id, req.user.id);
  if (!sourced) return res.status(404).json({ error: 'Sourced founder not found' });
  db.prepare("UPDATE sourced_founders SET status = 'dismissed', do_not_resurface = 1 WHERE id = ? AND user_id = ?").run(req.params.id, req.user.id);
  res.json({ message: 'Hidden permanently' });
});

// POST /api/sourcing/star/:id — save for later
router.post('/star/:id', (req, res) => {
  const sourced = db.prepare("SELECT * FROM sourced_founders WHERE id = ? AND user_id = ? AND status = 'pending'").get(req.params.id, req.user.id);
  if (!sourced) return res.status(404).json({ error: 'Sourced founder not found' });

  db.prepare('UPDATE sourced_founders SET status = ? WHERE id = ? AND user_id = ?').run('starred', req.params.id, req.user.id);
  res.json({ message: 'Starred' });
});

// POST /api/sourcing/unstar/:id — move back to pending
router.post('/unstar/:id', (req, res) => {
  const sourced = db.prepare("SELECT * FROM sourced_founders WHERE id = ? AND user_id = ? AND status = 'starred'").get(req.params.id, req.user.id);
  if (!sourced) return res.status(404).json({ error: 'Not found' });

  db.prepare('UPDATE sourced_founders SET status = ? WHERE id = ? AND user_id = ?').run('pending', req.params.id, req.user.id);
  res.json({ message: 'Unstarred' });
});

// POST /api/sourcing/run — trigger manual sourcing run
// Manual triggers always do a full sweep (all query groups, not just today's rotation)
router.post('/run', async (req, res) => {
  try {
    const { assertWithinBudget, SpendCapError } = require('../lib/providerKeys');
    try { assertWithinBudget(req.user.id); }
    catch (e) { if (e instanceof SpendCapError) return res.status(402).json({ error: e.message }); throw e; }
    const { runSourcingEngine } = require('../pipeline/sourcing-engine');
    const { recordJobRun } = require('../services/health');
    const uid = req.user.id;
    res.json({ message: 'Full sweep started — query groups + early-signal connectors (YC, cohorts)' });
    // Run the classic Exa sweep AND the pluggable early-signal connectors (YC directory,
    // cohort programs) together, so a manual Run refreshes everything — not just the daily cron.
    Promise.all([
      runSourcingEngine({ fullSweep: true, userId: uid }),
      require('../pipeline/sources').ingestAll({ userId: uid }).catch(e => { console.error('[Sources] ingestAll error:', e.message); return null; }),
    ])
      .then(async ([r]) => {
        // Read the freshly-sourced founders' real LinkedIn: promote buried IL ties + flag noise.
        try { const e = await require('../pipeline/linkedin-enrich').runLinkedInEnrichment({ userId: uid, limit: 40 }); console.log('[Run][LinkedIn]', JSON.stringify(e)); }
        catch (e) { console.error('[Run][LinkedIn]', e.message); }
        recordJobRun('sourcing_run', (r.errors && r.errors.length) ? 'partial' : 'ok', `+${r.totalAdded} added, ${r.totalFiltered} filtered${r.errors && r.errors.length ? `, ${r.errors.length} errors` : ''}`, uid);
      })
      .catch(err => { recordJobRun('sourcing_run', 'error', err.message, uid); console.error('[Sourcing] Run error:', err); });
  } catch (err) {
    res.status(500).json({ error: 'Failed to start sourcing run: ' + err.message });
  }
});

// POST /api/sourcing/digest — send the weekly founder digest now (on-demand / test).
router.post('/digest', async (req, res) => {
  try {
    const { sendFounderDigest } = require('../services/founder-digest');
    const r = await sendFounderDigest(req.user.id, { force: true });
    res.status(r.ok ? 200 : 400).json(r);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// GET /api/sourcing/stats — enhanced stats
router.get('/stats', (req, res) => {
  // Counts that feed VISIBLE surfaces (pending inbox, starred) honor the tie rule so the
  // headline number always matches what's actually shown. Historical approved/dismissed do not.
  const TP = [req.user.id, ...VALID_TIE_TYPES];
  const pending = db.prepare(`SELECT COUNT(*) as c FROM sourced_founders WHERE status = 'pending' AND user_id = ? AND ${TIE_CLAUSE}`).get(...TP).c;
  const starred = db.prepare(`SELECT COUNT(*) as c FROM sourced_founders WHERE status = 'starred' AND user_id = ? AND ${TIE_CLAUSE}`).get(...TP).c;
  const approved = db.prepare("SELECT COUNT(*) as c FROM sourced_founders WHERE status = 'approved' AND user_id = ?").get(req.user.id).c;
  const dismissed = db.prepare("SELECT COUNT(*) as c FROM sourced_founders WHERE status = 'dismissed' AND user_id = ?").get(req.user.id).c;
  const bySrc = db.prepare(`SELECT source, COUNT(*) as count FROM sourced_founders WHERE status = 'pending' AND user_id = ? AND ${TIE_CLAUSE} GROUP BY source`).all(...TP);
  const byScore = db.prepare(`SELECT CASE WHEN confidence_score >= 8 THEN 'high' WHEN confidence_score >= 6 THEN 'medium' ELSE 'low' END as tier, COUNT(*) as count FROM sourced_founders WHERE status = 'pending' AND user_id = ? AND ${TIE_CLAUSE} GROUP BY tier`).all(...TP);
  // Caliber breakdown — how many best-of-best are sitting in the inbox right now.
  const byCaliberRows = db.prepare(`SELECT COALESCE(caliber_tier, 'C') as tier, COUNT(*) as count FROM sourced_founders WHERE status = 'pending' AND user_id = ? AND ${TIE_CLAUSE} GROUP BY tier`).all(...TP);
  const byCaliber = { S: 0, A: 0, B: 0, C: 0 };
  for (const r of byCaliberRows) { if (byCaliber[r.tier] != null) byCaliber[r.tier] = r.count; }
  const lastRun = db.prepare('SELECT * FROM sourcing_runs WHERE user_id = ? ORDER BY run_at DESC LIMIT 1').get(req.user.id);
  const todayAdded = db.prepare(`SELECT COUNT(*) as c FROM sourced_founders WHERE status = 'pending' AND user_id = ? AND ${TIE_CLAUSE} AND DATE(created_at) = DATE('now')`).get(...TP).c;

  // Learning loop status — how much taste signal Stu has, and what it's learned.
  let learning = { likedN: 0, passedN: 0, favored: [], disfavored: [] };
  try {
    const { computeTasteProfile } = require('../pipeline/taste');
    const t = computeTasteProfile(req.user.id);
    const label = (k) => k.replace(/^(domain|ped|bld|cal|tie|tier):/, '');
    learning = { likedN: t.likedN, passedN: t.passedN, favored: t.favored.map(label), disfavored: t.disfavored.map(label) };
  } catch {}

  // Exploration lane — high-caliber founders that do NOT match the learned pattern, so the
  // funnel never collapses into a monoculture. Surfaced separately, labeled exploration.
  let exploration = [];
  try {
    exploration = db.prepare(`
      SELECT id, name, company, company_one_liner, caliber_tier, confidence_score, chicago_connection, linkedin_url
      FROM sourced_founders
      WHERE user_id = ? AND status = 'pending' AND ${TIE_CLAUSE} AND caliber_tier IN ('S','A') AND COALESCE(affinity_score, 0) <= 0
      ORDER BY (CASE caliber_tier WHEN 'S' THEN 2 ELSE 1 END) DESC, confidence_score DESC LIMIT 3
    `).all(req.user.id, ...VALID_TIE_TYPES);
  } catch {}

  res.json({ pending, starred, approved, dismissed, bySource: bySrc, byScore, byCaliber, learning, exploration, lastRun, todayAdded });
});

// GET /api/sourcing/taste-profile — derived, falsifiable taste profile (plain-English + evidence)
router.get('/taste-profile', (req, res) => {
  try { res.json(require('../pipeline/taste').tasteInsights(req.user.id)); }
  catch (e) { res.status(500).json({ error: e.message }); }
});

module.exports = router;
