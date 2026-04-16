const express = require('express');
const router = express.Router();
const db = require('../../db');

const SCALAR_FIELDS = [
  'portfolio_company_id', 'title', 'band',
  'min_years_experience', 'max_years_experience',
  'comp_low', 'comp_high', 'equity_low', 'equity_high',
  'remote_ok', 'location_pref', 'priority', 'status',
  'filled_by_candidate_id', 'jd_content', 'notes'
];
const ARRAY_FIELDS = ['stack_requirements', 'domain_requirements', 'must_haves', 'nice_to_haves'];
const ALL_FIELDS = [...SCALAR_FIELDS, ...ARRAY_FIELDS];

function serialize(body, field) {
  if (ARRAY_FIELDS.includes(field)) {
    const v = body[field];
    if (v === null || v === undefined) return null;
    if (typeof v === 'string') return v;
    return JSON.stringify(v);
  }
  return body[field];
}

function hydrate(row) {
  if (!row) return row;
  for (const field of ARRAY_FIELDS) {
    if (row[field]) {
      try { row[field] = JSON.parse(row[field]); } catch { row[field] = []; }
    } else {
      row[field] = [];
    }
  }
  return row;
}

// GET /api/talent/roles — list all, optional filter
router.get('/', (req, res) => {
  const { portfolio_company_id, status, band, priority, search } = req.query;
  let where = 'r.user_id = ? AND r.is_deleted = 0';
  const params = [req.user.id];
  if (portfolio_company_id) { where += ' AND r.portfolio_company_id = ?'; params.push(portfolio_company_id); }
  if (status && status !== 'all') { where += ' AND r.status = ?'; params.push(status); }
  if (band) { where += ' AND r.band = ?'; params.push(band); }
  if (priority) { where += ' AND r.priority = ?'; params.push(priority); }
  if (search) { where += ' AND r.title LIKE ?'; params.push(`%${search}%`); }

  const rows = db.prepare(`
    SELECT r.*, c.name as company_name, c.logo_url as company_logo,
      (SELECT COUNT(*) FROM talent_matches m WHERE m.role_id = r.id AND m.is_deleted = 0 AND m.status = 'suggested') as pending_matches,
      (SELECT COUNT(*) FROM talent_matches m WHERE m.role_id = r.id AND m.is_deleted = 0 AND m.status IN ('shortlisted','intro_drafted','intro_sent','in_process')) as active_matches
    FROM talent_roles r
    LEFT JOIN talent_portfolio_companies c ON r.portfolio_company_id = c.id
    WHERE ${where}
    ORDER BY
      CASE r.priority WHEN 'urgent' THEN 0 WHEN 'normal' THEN 1 ELSE 2 END,
      r.updated_at DESC
  `).all(...params);

  res.json(rows.map(hydrate));
});

// GET /api/talent/roles/:id
router.get('/:id', (req, res) => {
  const row = db.prepare(`
    SELECT r.*, c.name as company_name, c.one_liner as company_one_liner, c.logo_url as company_logo
    FROM talent_roles r
    LEFT JOIN talent_portfolio_companies c ON r.portfolio_company_id = c.id
    WHERE r.id = ? AND r.user_id = ? AND r.is_deleted = 0
  `).get(req.params.id, req.user.id);
  if (!row) return res.status(404).json({ error: 'Not found' });

  // Attach matches
  const matches = db.prepare(`
    SELECT m.*, cand.name as candidate_name, cand.headline, cand.current_company, cand.current_role,
      cand.linkedin_url, cand.github_url, cand.overall_score, cand.location_city
    FROM talent_matches m
    JOIN talent_candidates cand ON m.candidate_id = cand.id
    WHERE m.role_id = ? AND m.is_deleted = 0
    ORDER BY m.match_score DESC
  `).all(req.params.id);

  res.json({ ...hydrate(row), matches });
});

// POST /api/talent/roles
router.post('/', (req, res) => {
  const body = req.body || {};
  if (!body.title || !body.title.trim()) return res.status(400).json({ error: 'Title is required' });
  if (!body.portfolio_company_id) return res.status(400).json({ error: 'portfolio_company_id is required' });

  // Verify portfolio co belongs to user
  const co = db.prepare('SELECT id FROM talent_portfolio_companies WHERE id = ? AND user_id = ? AND is_deleted = 0').get(body.portfolio_company_id, req.user.id);
  if (!co) return res.status(400).json({ error: 'Invalid portfolio company' });

  const cols = ['user_id', ...ALL_FIELDS];
  const vals = [req.user.id, ...ALL_FIELDS.map(f => serialize(body, f) ?? null)];
  const placeholders = cols.map(() => '?').join(', ');
  const result = db.prepare(`INSERT INTO talent_roles (${cols.join(', ')}) VALUES (${placeholders})`).run(...vals);
  const row = db.prepare('SELECT * FROM talent_roles WHERE id = ?').get(result.lastInsertRowid);
  res.json(hydrate(row));
});

// PUT /api/talent/roles/:id
router.put('/:id', (req, res) => {
  const existing = db.prepare('SELECT * FROM talent_roles WHERE id = ? AND user_id = ? AND is_deleted = 0').get(req.params.id, req.user.id);
  if (!existing) return res.status(404).json({ error: 'Not found' });

  const updates = [];
  const params = [];
  for (const field of ALL_FIELDS) {
    if (field in req.body) {
      updates.push(`${field} = ?`);
      params.push(serialize(req.body, field));
    }
  }
  if (updates.length === 0) return res.json(hydrate(existing));

  updates.push('updated_at = CURRENT_TIMESTAMP');
  params.push(req.params.id, req.user.id);
  db.prepare(`UPDATE talent_roles SET ${updates.join(', ')} WHERE id = ? AND user_id = ?`).run(...params);
  const row = db.prepare('SELECT * FROM talent_roles WHERE id = ?').get(req.params.id);
  res.json(hydrate(row));
});

// DELETE /api/talent/roles/:id
router.delete('/:id', (req, res) => {
  const existing = db.prepare('SELECT id FROM talent_roles WHERE id = ? AND user_id = ? AND is_deleted = 0').get(req.params.id, req.user.id);
  if (!existing) return res.status(404).json({ error: 'Not found' });
  db.prepare('UPDATE talent_roles SET is_deleted = 1, deleted_at = CURRENT_TIMESTAMP WHERE id = ? AND user_id = ?').run(req.params.id, req.user.id);
  res.json({ success: true });
});

// POST /api/talent/roles/bulk/delete
router.post('/bulk/delete', (req, res) => {
  const ids = Array.isArray(req.body?.ids) ? req.body.ids.filter(Number.isInteger) : [];
  if (ids.length === 0) return res.status(400).json({ error: 'No ids' });
  const placeholders = ids.map(() => '?').join(', ');
  db.prepare(`UPDATE talent_roles SET is_deleted = 1, deleted_at = CURRENT_TIMESTAMP WHERE id IN (${placeholders}) AND user_id = ?`).run(...ids, req.user.id);
  res.json({ success: true, count: ids.length });
});

// POST /api/talent/roles/bulk/update — bulk status/priority change
router.post('/bulk/update', (req, res) => {
  const { ids, patch } = req.body || {};
  if (!Array.isArray(ids) || ids.length === 0) return res.status(400).json({ error: 'No ids' });
  if (!patch || typeof patch !== 'object') return res.status(400).json({ error: 'No patch' });

  const updates = [];
  const params = [];
  for (const field of ALL_FIELDS) {
    if (field in patch) {
      updates.push(`${field} = ?`);
      params.push(serialize(patch, field));
    }
  }
  if (updates.length === 0) return res.status(400).json({ error: 'Empty patch' });
  updates.push('updated_at = CURRENT_TIMESTAMP');

  const placeholders = ids.map(() => '?').join(', ');
  db.prepare(`UPDATE talent_roles SET ${updates.join(', ')} WHERE id IN (${placeholders}) AND user_id = ?`).run(...params, ...ids, req.user.id);
  res.json({ success: true, count: ids.length });
});

module.exports = router;
