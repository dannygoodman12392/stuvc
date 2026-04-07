const express = require('express');
const router = express.Router();
const db = require('../db');

// GET /api/search?q=...
router.get('/', (req, res) => {
  const q = (req.query.q || '').trim();
  if (!q || q.length < 2) return res.json({ founders: [], notes: [], calls: [], assessments: [] });

  const like = `%${q}%`;

  // Search founders
  const founders = db.prepare(`
    SELECT id, name, company, role, domain, stage, status, company_one_liner, pipeline_tracks, deal_status, admissions_status
    FROM founders
    WHERE is_deleted = 0 AND created_by = ? AND (
      name LIKE ? OR company LIKE ? OR domain LIKE ? OR bio LIKE ? OR company_one_liner LIKE ? OR notable_background LIKE ? OR previous_companies LIKE ?
    )
    ORDER BY updated_at DESC LIMIT 10
  `).all(req.user.id, like, like, like, like, like, like, like);

  // Search notes
  const notes = db.prepare(`
    SELECT n.id, n.content, n.created_at, n.founder_id, f.name as founder_name, f.company as founder_company
    FROM founder_notes n
    JOIN founders f ON n.founder_id = f.id
    WHERE f.is_deleted = 0 AND f.created_by = ? AND n.content LIKE ?
    ORDER BY n.created_at DESC LIMIT 8
  `).all(req.user.id, like);

  // Search calls
  const calls = db.prepare(`
    SELECT c.id, c.structured_summary, c.created_at, c.founder_id, f.name as founder_name, f.company as founder_company
    FROM call_logs c
    JOIN founders f ON c.founder_id = f.id
    WHERE f.is_deleted = 0 AND f.created_by = ? AND (c.raw_transcript LIKE ? OR c.structured_summary LIKE ?)
    ORDER BY c.created_at DESC LIMIT 8
  `).all(req.user.id, like, like);

  // Search assessments
  const assessments = db.prepare(`
    SELECT a.id, a.overall_signal, a.status, a.created_at, a.founder_id, f.name as founder_name, f.company as founder_company
    FROM opportunity_assessments a
    LEFT JOIN founders f ON a.founder_id = f.id
    WHERE a.is_deleted = 0 AND a.created_by = ? AND (
      a.synthesis_output LIKE ? OR a.founder_agent_output LIKE ? OR f.name LIKE ? OR f.company LIKE ?
    )
    ORDER BY a.created_at DESC LIMIT 8
  `).all(req.user.id, like, like, like, like);

  // Search memos
  const memos = db.prepare(`
    SELECT m.id, m.version, m.created_at, m.founder_id, f.name as founder_name, f.company as founder_company
    FROM founder_memos m
    JOIN founders f ON m.founder_id = f.id
    WHERE f.is_deleted = 0 AND f.created_by = ? AND m.content LIKE ?
    ORDER BY m.created_at DESC LIMIT 5
  `).all(req.user.id, like);

  res.json({ founders, notes, calls, assessments, memos });
});

module.exports = router;
