const express = require('express');
const router = express.Router();
const db = require('../../db');

// GET /api/talent/matches — match queue
router.get('/', (req, res) => {
  const { status, role_id, candidate_id, minScore } = req.query;
  let where = 'm.user_id = ? AND m.is_deleted = 0';
  const params = [req.user.id];
  if (status && status !== 'all') { where += ' AND m.status = ?'; params.push(status); }
  if (role_id) { where += ' AND m.role_id = ?'; params.push(role_id); }
  if (candidate_id) { where += ' AND m.candidate_id = ?'; params.push(candidate_id); }
  if (minScore) { where += ' AND m.match_score >= ?'; params.push(parseInt(minScore)); }

  const rows = db.prepare(`
    SELECT m.*,
      cand.name as candidate_name, cand.headline, cand.current_company, cand.current_role,
      cand.linkedin_url, cand.github_url, cand.overall_score, cand.location_city,
      cand.pedigree_signals as candidate_pedigree, cand.builder_signals as candidate_builder,
      r.title as role_title, r.band as role_band,
      c.name as company_name, c.logo_url as company_logo, c.id as company_id
    FROM talent_matches m
    JOIN talent_candidates cand ON m.candidate_id = cand.id
    JOIN talent_roles r ON m.role_id = r.id
    LEFT JOIN talent_portfolio_companies c ON r.portfolio_company_id = c.id
    WHERE ${where}
    ORDER BY m.match_score DESC, m.surfaced_at DESC
    LIMIT 500
  `).all(...params);

  // Parse JSON fields
  const out = rows.map(row => {
    for (const f of ['strengths', 'gaps', 'candidate_pedigree', 'candidate_builder']) {
      if (row[f]) { try { row[f] = JSON.parse(row[f]); } catch { row[f] = []; } }
      else row[f] = [];
    }
    return row;
  });
  res.json(out);
});

// GET /api/talent/matches/stats
router.get('/stats', (req, res) => {
  const stats = db.prepare(`
    SELECT status, COUNT(*) as count
    FROM talent_matches
    WHERE user_id = ? AND is_deleted = 0
    GROUP BY status
  `).all(req.user.id);
  const map = {};
  for (const s of stats) map[s.status] = s.count;
  res.json(map);
});

// POST /api/talent/matches — manual match create
router.post('/', (req, res) => {
  const { candidate_id, role_id, match_score, match_rationale, strengths, gaps, status } = req.body || {};
  if (!candidate_id || !role_id) return res.status(400).json({ error: 'candidate_id and role_id required' });

  // Verify both belong to user
  const cand = db.prepare('SELECT id FROM talent_candidates WHERE id = ? AND user_id = ? AND is_deleted = 0').get(candidate_id, req.user.id);
  const role = db.prepare('SELECT id FROM talent_roles WHERE id = ? AND user_id = ? AND is_deleted = 0').get(role_id, req.user.id);
  if (!cand || !role) return res.status(400).json({ error: 'Invalid candidate or role' });

  try {
    const result = db.prepare(`
      INSERT INTO talent_matches (user_id, candidate_id, role_id, match_score, match_rationale, strengths, gaps, status)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      req.user.id, candidate_id, role_id,
      match_score ?? null,
      match_rationale ?? null,
      strengths ? JSON.stringify(strengths) : null,
      gaps ? JSON.stringify(gaps) : null,
      status || 'suggested'
    );
    const row = db.prepare('SELECT * FROM talent_matches WHERE id = ?').get(result.lastInsertRowid);
    res.json(row);
  } catch (err) {
    if (err.message.includes('UNIQUE')) {
      return res.status(409).json({ error: 'Match already exists for this candidate and role' });
    }
    res.status(500).json({ error: err.message });
  }
});

// PUT /api/talent/matches/:id — update status/notes
router.put('/:id', (req, res) => {
  const existing = db.prepare('SELECT * FROM talent_matches WHERE id = ? AND user_id = ? AND is_deleted = 0').get(req.params.id, req.user.id);
  if (!existing) return res.status(404).json({ error: 'Not found' });

  const FIELDS = ['status', 'match_score', 'match_rationale'];
  const ARRAY = ['strengths', 'gaps'];
  const updates = [];
  const params = [];
  for (const f of FIELDS) {
    if (f in req.body) { updates.push(`${f} = ?`); params.push(req.body[f]); }
  }
  for (const f of ARRAY) {
    if (f in req.body) {
      updates.push(`${f} = ?`);
      const v = req.body[f];
      params.push(v === null ? null : (typeof v === 'string' ? v : JSON.stringify(v)));
    }
  }
  if (updates.length === 0) return res.json(existing);

  updates.push('updated_at = CURRENT_TIMESTAMP', 'last_action_at = CURRENT_TIMESTAMP');
  params.push(req.params.id, req.user.id);
  db.prepare(`UPDATE talent_matches SET ${updates.join(', ')} WHERE id = ? AND user_id = ?`).run(...params);
  const row = db.prepare('SELECT * FROM talent_matches WHERE id = ?').get(req.params.id);
  res.json(row);
});

// DELETE /api/talent/matches/:id
router.delete('/:id', (req, res) => {
  const existing = db.prepare('SELECT id FROM talent_matches WHERE id = ? AND user_id = ? AND is_deleted = 0').get(req.params.id, req.user.id);
  if (!existing) return res.status(404).json({ error: 'Not found' });
  db.prepare('UPDATE talent_matches SET is_deleted = 1, deleted_at = CURRENT_TIMESTAMP WHERE id = ? AND user_id = ?').run(req.params.id, req.user.id);
  res.json({ success: true });
});

// POST /api/talent/matches/bulk/update — bulk status change (e.g., shortlist 5 at once)
router.post('/bulk/update', (req, res) => {
  const { ids, patch } = req.body || {};
  if (!Array.isArray(ids) || ids.length === 0) return res.status(400).json({ error: 'No ids' });
  if (!patch || typeof patch !== 'object') return res.status(400).json({ error: 'No patch' });

  const updates = [];
  const params = [];
  if ('status' in patch) { updates.push('status = ?'); params.push(patch.status); }
  if ('match_score' in patch) { updates.push('match_score = ?'); params.push(patch.match_score); }
  if (updates.length === 0) return res.status(400).json({ error: 'Empty patch' });
  updates.push('updated_at = CURRENT_TIMESTAMP', 'last_action_at = CURRENT_TIMESTAMP');

  const placeholders = ids.map(() => '?').join(', ');
  db.prepare(`UPDATE talent_matches SET ${updates.join(', ')} WHERE id IN (${placeholders}) AND user_id = ?`).run(...params, ...ids, req.user.id);
  res.json({ success: true, count: ids.length });
});

// POST /api/talent/matches/bulk/delete
router.post('/bulk/delete', (req, res) => {
  const ids = Array.isArray(req.body?.ids) ? req.body.ids.filter(Number.isInteger) : [];
  if (ids.length === 0) return res.status(400).json({ error: 'No ids' });
  const placeholders = ids.map(() => '?').join(', ');
  db.prepare(`UPDATE talent_matches SET is_deleted = 1, deleted_at = CURRENT_TIMESTAMP WHERE id IN (${placeholders}) AND user_id = ?`).run(...ids, req.user.id);
  res.json({ success: true, count: ids.length });
});

module.exports = router;
