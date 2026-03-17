const express = require('express');
const router = express.Router();
const db = require('../db');

// GET /api/sourcing/queue — pending sourced founders
router.get('/queue', (req, res) => {
  const { sort, source } = req.query;
  let where = "status = 'pending'";
  const params = [];

  if (source) {
    where += ' AND source = ?';
    params.push(source);
  }

  const sortCol = sort === 'newest' ? 'created_at DESC' : 'confidence_score DESC';
  const founders = db.prepare(`SELECT * FROM sourced_founders WHERE ${where} ORDER BY ${sortCol}`).all(...params);
  res.json(founders);
});

// GET /api/sourcing/runs — sourcing run history
router.get('/runs', (req, res) => {
  const runs = db.prepare('SELECT * FROM sourcing_runs ORDER BY run_at DESC LIMIT 20').all();
  res.json(runs);
});

// POST /api/sourcing/approve/:id — promote to pipeline
router.post('/approve/:id', (req, res) => {
  const sourced = db.prepare('SELECT * FROM sourced_founders WHERE id = ? AND status = ?').get(req.params.id, 'pending');
  if (!sourced) return res.status(404).json({ error: 'Sourced founder not found or already processed' });

  // Create founder record
  const result = db.prepare(`
    INSERT INTO founders (name, company, role, email, linkedin_url, source, fit_score, fit_score_rationale, status, created_by)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'Identified', ?)
  `).run(sourced.name, sourced.company, sourced.role, sourced.email, sourced.linkedin_url, sourced.source, sourced.confidence_score, sourced.confidence_rationale, req.user.id);

  // Update sourced record
  db.prepare('UPDATE sourced_founders SET status = ?, promoted_to_founder_id = ? WHERE id = ?').run('approved', result.lastInsertRowid, req.params.id);

  const founder = db.prepare('SELECT * FROM founders WHERE id = ?').get(result.lastInsertRowid);
  res.json(founder);
});

// POST /api/sourcing/dismiss/:id
router.post('/dismiss/:id', (req, res) => {
  const sourced = db.prepare('SELECT * FROM sourced_founders WHERE id = ? AND status = ?').get(req.params.id, 'pending');
  if (!sourced) return res.status(404).json({ error: 'Sourced founder not found or already processed' });

  db.prepare('UPDATE sourced_founders SET status = ? WHERE id = ?').run('dismissed', req.params.id);
  res.json({ message: 'Dismissed' });
});

// POST /api/sourcing/run — trigger manual sourcing run
router.post('/run', async (req, res) => {
  try {
    const { runSourcingEngine } = require('../pipeline/sourcing-engine');
    res.json({ message: 'Sourcing run started' });
    runSourcingEngine().catch(err => console.error('Sourcing run error:', err));
  } catch (err) {
    res.status(500).json({ error: 'Failed to start sourcing run: ' + err.message });
  }
});

// GET /api/sourcing/stats
router.get('/stats', (req, res) => {
  const pending = db.prepare("SELECT COUNT(*) as c FROM sourced_founders WHERE status = 'pending'").get().c;
  const approved = db.prepare("SELECT COUNT(*) as c FROM sourced_founders WHERE status = 'approved'").get().c;
  const dismissed = db.prepare("SELECT COUNT(*) as c FROM sourced_founders WHERE status = 'dismissed'").get().c;
  const bySrc = db.prepare("SELECT source, COUNT(*) as count FROM sourced_founders WHERE status = 'pending' GROUP BY source").all();
  const lastRun = db.prepare('SELECT * FROM sourcing_runs ORDER BY run_at DESC LIMIT 1').get();

  res.json({ pending, approved, dismissed, bySource: bySrc, lastRun });
});

module.exports = router;
