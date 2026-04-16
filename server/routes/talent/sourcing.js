const express = require('express');
const router = express.Router();
const db = require('../../db');

// GET /api/talent/sourcing/runs
router.get('/runs', (req, res) => {
  const rows = db.prepare('SELECT * FROM talent_sourcing_runs WHERE user_id = ? ORDER BY run_at DESC LIMIT 20').all(req.user.id);
  res.json(rows);
});

// GET /api/talent/sourcing/stats — high-level digest for Talent Home
router.get('/stats', (req, res) => {
  const u = req.user.id;
  const stats = {
    portfolio_total: db.prepare('SELECT COUNT(*) as c FROM talent_portfolio_companies WHERE user_id = ? AND is_deleted = 0 AND status = ?').get(u, 'active').c,
    roles_open: db.prepare("SELECT COUNT(*) as c FROM talent_roles WHERE user_id = ? AND is_deleted = 0 AND status = 'open'").get(u).c,
    roles_urgent: db.prepare("SELECT COUNT(*) as c FROM talent_roles WHERE user_id = ? AND is_deleted = 0 AND status = 'open' AND priority = 'urgent'").get(u).c,
    candidates_new: db.prepare("SELECT COUNT(*) as c FROM talent_candidates WHERE user_id = ? AND is_deleted = 0 AND status = 'new'").get(u).c,
    candidates_total: db.prepare('SELECT COUNT(*) as c FROM talent_candidates WHERE user_id = ? AND is_deleted = 0').get(u).c,
    matches_pending: db.prepare("SELECT COUNT(*) as c FROM talent_matches WHERE user_id = ? AND is_deleted = 0 AND status = 'suggested'").get(u).c,
    matches_shortlisted: db.prepare("SELECT COUNT(*) as c FROM talent_matches WHERE user_id = ? AND is_deleted = 0 AND status = 'shortlisted'").get(u).c,
    matches_in_process: db.prepare("SELECT COUNT(*) as c FROM talent_matches WHERE user_id = ? AND is_deleted = 0 AND status IN ('intro_drafted','intro_sent','in_process')").get(u).c,
    hired: db.prepare("SELECT COUNT(*) as c FROM talent_matches WHERE user_id = ? AND is_deleted = 0 AND status = 'hired'").get(u).c,
  };

  // Top 5 highest-score pending matches for surfacing on Home
  stats.top_matches = db.prepare(`
    SELECT m.id, m.match_score, m.match_rationale,
      cand.name as candidate_name, cand.current_company, cand.headline,
      r.title as role_title, c.name as company_name
    FROM talent_matches m
    JOIN talent_candidates cand ON m.candidate_id = cand.id
    JOIN talent_roles r ON m.role_id = r.id
    LEFT JOIN talent_portfolio_companies c ON r.portfolio_company_id = c.id
    WHERE m.user_id = ? AND m.is_deleted = 0 AND m.status = 'suggested'
    ORDER BY m.match_score DESC
    LIMIT 5
  `).all(u);

  stats.recent_candidates = db.prepare(`
    SELECT id, name, headline, current_company, current_role, overall_score, source, created_at
    FROM talent_candidates
    WHERE user_id = ? AND is_deleted = 0
    ORDER BY created_at DESC LIMIT 10
  `).all(u);

  res.json(stats);
});

// POST /api/talent/sourcing/run — trigger run now (async)
// Body: { fullSweep?: bool, role_id?: number }
// When role_id is provided, the engine scopes to that role (strict location + band).
router.post('/run', async (req, res) => {
  try {
    const { runTalentEngine } = require('../../pipeline/talent-engine');
    const roleId = req.body?.role_id ? parseInt(req.body.role_id) : null;
    runTalentEngine({ userId: req.user.id, fullSweep: !!req.body?.fullSweep, roleId })
      .then(r => console.log('[TalentSourcing] Run complete:', r))
      .catch(err => console.error('[TalentSourcing] Run failed:', err.message));
    res.json({ success: true, message: roleId ? `Sourcing started for role ${roleId}` : 'Talent sourcing run started' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST /api/talent/sourcing/match — rescore matches for a role or all
router.post('/match', async (req, res) => {
  try {
    const { runMatchEngine } = require('../../pipeline/match-engine');
    const role_id = req.body?.role_id;
    const candidate_id = req.body?.candidate_id;
    runMatchEngine({ userId: req.user.id, roleId: role_id, candidateId: candidate_id })
      .then(r => console.log('[TalentMatch] Done:', r))
      .catch(err => console.error('[TalentMatch] Failed:', err.message));
    res.json({ success: true, message: 'Match run started' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
