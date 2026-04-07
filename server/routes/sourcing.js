const express = require('express');
const router = express.Router();
const db = require('../db');

// GET /api/sourcing/queue — pending sourced founders with enhanced data
router.get('/queue', (req, res) => {
  const { sort, source, minScore, search } = req.query;
  let where = "status = 'pending' AND user_id = ?";
  const params = [];
  params.push(req.user.id);

  if (source) { where += ' AND source = ?'; params.push(source); }
  if (minScore) { where += ' AND confidence_score >= ?'; params.push(parseInt(minScore)); }
  if (search) {
    where += ' AND (name LIKE ? OR company LIKE ? OR headline LIKE ?)';
    params.push(`%${search}%`, `%${search}%`, `%${search}%`);
  }

  const sortCol = sort === 'newest' ? 'created_at DESC' : 'confidence_score DESC, created_at DESC';
  const founders = db.prepare(`SELECT * FROM sourced_founders WHERE ${where} ORDER BY ${sortCol}`).all(...params);
  res.json(founders);
});

// GET /api/sourcing/starred — starred for later review
router.get('/starred', (req, res) => {
  const founders = db.prepare("SELECT * FROM sourced_founders WHERE status = 'starred' AND user_id = ? ORDER BY confidence_score DESC").all(req.user.id);
  res.json(founders);
});

// GET /api/sourcing/runs — sourcing run history
router.get('/runs', (req, res) => {
  const runs = db.prepare('SELECT * FROM sourcing_runs WHERE user_id = ? ORDER BY run_at DESC LIMIT 20').all(req.user.id);
  res.json(runs);
});

// POST /api/sourcing/approve/:id — promote to admissions pipeline
router.post('/approve/:id', (req, res) => {
  const sourced = db.prepare("SELECT * FROM sourced_founders WHERE id = ? AND user_id = ? AND status IN ('pending', 'starred')").get(req.params.id, req.user.id);
  if (!sourced) return res.status(404).json({ error: 'Sourced founder not found or already processed' });

  // Parse JSON fields
  let tags = [];
  let pedigreeSignals = [];
  let builderSignals = [];
  try { tags = JSON.parse(sourced.tags || '[]'); } catch {}
  try { pedigreeSignals = JSON.parse(sourced.pedigree_signals || '[]'); } catch {}
  try { builderSignals = JSON.parse(sourced.builder_signals || '[]'); } catch {}

  // Create founder record with full data
  const result = db.prepare(`
    INSERT INTO founders (
      name, company, role, email, linkedin_url, github_url, website_url,
      source, fit_score, fit_score_rationale, chicago_connection,
      location_city, stage, domain, tags,
      status, pipeline_tracks, admissions_status,
      company_one_liner, notable_background, previous_companies,
      created_by
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    sourced.name,
    sourced.company || null,
    sourced.role || 'Founder',
    sourced.email || null,
    sourced.linkedin_url || null,
    sourced.github_url || null,
    sourced.website_url || null,
    sourced.source || 'sourcing-engine',
    sourced.confidence_score,
    sourced.confidence_rationale,
    sourced.chicago_connection || null,
    sourced.location_city || null,
    'Pre-seed',
    tags.find(t => ['AI/ML', 'Fintech', 'Healthtech', 'SaaS', 'Defense', 'Climate', 'DevTools', 'Biotech', 'Proptech', 'Edtech', 'Cybersecurity'].includes(t)) || null,
    JSON.stringify(tags),
    'Sourced',
    'admissions',
    'Sourced',
    sourced.company_one_liner || null,
    pedigreeSignals.length > 0 ? pedigreeSignals.join(', ') : null,
    builderSignals.length > 0 ? builderSignals.join(', ') : null,
    req.user.id
  );

  // Update sourced record
  db.prepare('UPDATE sourced_founders SET status = ?, promoted_to_founder_id = ? WHERE id = ?').run('approved', result.lastInsertRowid, req.params.id);

  // Fire-and-forget Airtable sync for new founder
  try {
    const airtableSync = require('../services/airtable-sync');
    const founder = db.prepare('SELECT * FROM founders WHERE id = ?').get(result.lastInsertRowid);
    if (founder) {
      airtableSync.pushAdmissionsChange(founder, null).catch(err =>
        console.error('[AirtableSync] New founder push failed:', err.message)
      );
    }
  } catch {}

  const founder = db.prepare('SELECT * FROM founders WHERE id = ?').get(result.lastInsertRowid);
  res.json(founder);
});

// POST /api/sourcing/dismiss/:id
router.post('/dismiss/:id', (req, res) => {
  const sourced = db.prepare("SELECT * FROM sourced_founders WHERE id = ? AND user_id = ? AND status IN ('pending', 'starred')").get(req.params.id, req.user.id);
  if (!sourced) return res.status(404).json({ error: 'Sourced founder not found or already processed' });

  db.prepare('UPDATE sourced_founders SET status = ? WHERE id = ? AND user_id = ?').run('dismissed', req.params.id, req.user.id);
  res.json({ message: 'Dismissed' });
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
    const { runSourcingEngine } = require('../pipeline/sourcing-engine');
    res.json({ message: 'Full sweep sourcing run started — running all query groups' });
    runSourcingEngine({ fullSweep: true, userId: req.user.id }).catch(err => console.error('[Sourcing] Run error:', err));
  } catch (err) {
    res.status(500).json({ error: 'Failed to start sourcing run: ' + err.message });
  }
});

// GET /api/sourcing/stats — enhanced stats
router.get('/stats', (req, res) => {
  const pending = db.prepare("SELECT COUNT(*) as c FROM sourced_founders WHERE status = 'pending' AND user_id = ?").get(req.user.id).c;
  const starred = db.prepare("SELECT COUNT(*) as c FROM sourced_founders WHERE status = 'starred' AND user_id = ?").get(req.user.id).c;
  const approved = db.prepare("SELECT COUNT(*) as c FROM sourced_founders WHERE status = 'approved' AND user_id = ?").get(req.user.id).c;
  const dismissed = db.prepare("SELECT COUNT(*) as c FROM sourced_founders WHERE status = 'dismissed' AND user_id = ?").get(req.user.id).c;
  const bySrc = db.prepare("SELECT source, COUNT(*) as count FROM sourced_founders WHERE status = 'pending' AND user_id = ? GROUP BY source").all(req.user.id);
  const byScore = db.prepare("SELECT CASE WHEN confidence_score >= 8 THEN 'high' WHEN confidence_score >= 6 THEN 'medium' ELSE 'low' END as tier, COUNT(*) as count FROM sourced_founders WHERE status = 'pending' AND user_id = ? GROUP BY tier").all(req.user.id);
  const lastRun = db.prepare('SELECT * FROM sourcing_runs WHERE user_id = ? ORDER BY run_at DESC LIMIT 1').get(req.user.id);
  const todayAdded = db.prepare("SELECT COUNT(*) as c FROM sourced_founders WHERE status = 'pending' AND user_id = ? AND DATE(created_at) = DATE('now')").get(req.user.id).c;

  res.json({ pending, starred, approved, dismissed, bySource: bySrc, byScore, lastRun, todayAdded });
});

module.exports = router;
