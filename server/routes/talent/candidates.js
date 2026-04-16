const express = require('express');
const router = express.Router();
const db = require('../../db');

const SCALAR_FIELDS = [
  'name', 'headline', 'linkedin_url', 'github_url', 'twitter_url',
  'website_url', 'email', 'current_company', 'current_role',
  'tenure_months', 'years_experience', 'location_city', 'location_state',
  'remote_ok', 'one_liner', 'source', 'status', 'starred', 'notes',
  'score_build_caliber', 'score_leap_readiness', 'score_domain_fit',
  'score_geography', 'overall_score', 'score_rationale'
];
const ARRAY_FIELDS = ['tech_stack', 'pedigree_signals', 'builder_signals', 'leap_signals', 'band_fit'];
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

// GET /api/talent/candidates
router.get('/', (req, res) => {
  const { search, status, band, minScore, source, starred, sort, location } = req.query;
  let where = 'user_id = ? AND is_deleted = 0';
  const params = [req.user.id];
  if (status && status !== 'all') { where += ' AND status = ?'; params.push(status); }
  if (starred === 'true') where += ' AND starred = 1';
  if (source) { where += ' AND source = ?'; params.push(source); }
  if (minScore) { where += ' AND overall_score >= ?'; params.push(parseInt(minScore)); }
  if (band) { where += ' AND band_fit LIKE ?'; params.push(`%"${band}"%`); }
  if (location) {
    where += ' AND (LOWER(location_city) LIKE ? OR LOWER(headline) LIKE ?)';
    const loc = `%${location.toLowerCase()}%`;
    params.push(loc, loc);
  }
  if (search) {
    where += ' AND (name LIKE ? OR headline LIKE ? OR current_company LIKE ? OR current_role LIKE ?)';
    const q = `%${search}%`;
    params.push(q, q, q, q);
  }

  const orderBy = sort === 'newest' ? 'created_at DESC' : 'overall_score DESC, created_at DESC';
  const rows = db.prepare(`SELECT * FROM talent_candidates WHERE ${where} ORDER BY ${orderBy} LIMIT 500`).all(...params);
  res.json(rows.map(hydrate));
});

// GET /api/talent/candidates/stats
router.get('/stats', (req, res) => {
  const base = 'user_id = ? AND is_deleted = 0';
  const stats = {
    total: db.prepare(`SELECT COUNT(*) as c FROM talent_candidates WHERE ${base}`).get(req.user.id).c,
    new: db.prepare(`SELECT COUNT(*) as c FROM talent_candidates WHERE ${base} AND status = 'new'`).get(req.user.id).c,
    shortlisted: db.prepare(`SELECT COUNT(*) as c FROM talent_candidates WHERE ${base} AND status = 'shortlisted'`).get(req.user.id).c,
    starred: db.prepare(`SELECT COUNT(*) as c FROM talent_candidates WHERE ${base} AND starred = 1`).get(req.user.id).c,
    highScore: db.prepare(`SELECT COUNT(*) as c FROM talent_candidates WHERE ${base} AND overall_score >= 8`).get(req.user.id).c,
  };
  res.json(stats);
});

// GET /api/talent/candidates/:id
router.get('/:id', (req, res) => {
  const row = db.prepare('SELECT * FROM talent_candidates WHERE id = ? AND user_id = ? AND is_deleted = 0').get(req.params.id, req.user.id);
  if (!row) return res.status(404).json({ error: 'Not found' });

  const matches = db.prepare(`
    SELECT m.*, r.title as role_title, r.band as role_band,
      c.name as company_name, c.logo_url as company_logo
    FROM talent_matches m
    JOIN talent_roles r ON m.role_id = r.id
    LEFT JOIN talent_portfolio_companies c ON r.portfolio_company_id = c.id
    WHERE m.candidate_id = ? AND m.is_deleted = 0
    ORDER BY m.match_score DESC
  `).all(req.params.id);

  res.json({ ...hydrate(row), matches });
});

// POST /api/talent/candidates — manual add
router.post('/', (req, res) => {
  const body = req.body || {};
  if (!body.name || !body.name.trim()) return res.status(400).json({ error: 'Name is required' });

  const cols = ['user_id', ...ALL_FIELDS];
  const vals = [req.user.id, ...ALL_FIELDS.map(f => serialize(body, f) ?? null)];
  const placeholders = cols.map(() => '?').join(', ');
  const result = db.prepare(`INSERT INTO talent_candidates (${cols.join(', ')}) VALUES (${placeholders})`).run(...vals);
  const row = db.prepare('SELECT * FROM talent_candidates WHERE id = ?').get(result.lastInsertRowid);
  res.json(hydrate(row));
});

// PUT /api/talent/candidates/:id
router.put('/:id', (req, res) => {
  const existing = db.prepare('SELECT * FROM talent_candidates WHERE id = ? AND user_id = ? AND is_deleted = 0').get(req.params.id, req.user.id);
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
  db.prepare(`UPDATE talent_candidates SET ${updates.join(', ')} WHERE id = ? AND user_id = ?`).run(...params);
  const row = db.prepare('SELECT * FROM talent_candidates WHERE id = ?').get(req.params.id);
  res.json(hydrate(row));
});

// DELETE /api/talent/candidates/:id
router.delete('/:id', (req, res) => {
  const existing = db.prepare('SELECT id FROM talent_candidates WHERE id = ? AND user_id = ? AND is_deleted = 0').get(req.params.id, req.user.id);
  if (!existing) return res.status(404).json({ error: 'Not found' });
  db.prepare('UPDATE talent_candidates SET is_deleted = 1, deleted_at = CURRENT_TIMESTAMP WHERE id = ? AND user_id = ?').run(req.params.id, req.user.id);
  res.json({ success: true });
});

// POST /api/talent/candidates/:id/star|unstar|dismiss|shortlist
router.post('/:id/star', (req, res) => {
  db.prepare('UPDATE talent_candidates SET starred = 1, updated_at = CURRENT_TIMESTAMP WHERE id = ? AND user_id = ?').run(req.params.id, req.user.id);
  res.json({ success: true });
});
router.post('/:id/unstar', (req, res) => {
  db.prepare('UPDATE talent_candidates SET starred = 0, updated_at = CURRENT_TIMESTAMP WHERE id = ? AND user_id = ?').run(req.params.id, req.user.id);
  res.json({ success: true });
});
router.post('/:id/dismiss', (req, res) => {
  db.prepare("UPDATE talent_candidates SET status = 'dismissed', updated_at = CURRENT_TIMESTAMP WHERE id = ? AND user_id = ?").run(req.params.id, req.user.id);
  res.json({ success: true });
});
router.post('/:id/shortlist', (req, res) => {
  db.prepare("UPDATE talent_candidates SET status = 'shortlisted', updated_at = CURRENT_TIMESTAMP WHERE id = ? AND user_id = ?").run(req.params.id, req.user.id);
  res.json({ success: true });
});

// POST /api/talent/candidates/bulk/delete
router.post('/bulk/delete', (req, res) => {
  const ids = Array.isArray(req.body?.ids) ? req.body.ids.filter(Number.isInteger) : [];
  if (ids.length === 0) return res.status(400).json({ error: 'No ids' });
  const placeholders = ids.map(() => '?').join(', ');
  db.prepare(`UPDATE talent_candidates SET is_deleted = 1, deleted_at = CURRENT_TIMESTAMP WHERE id IN (${placeholders}) AND user_id = ?`).run(...ids, req.user.id);
  res.json({ success: true, count: ids.length });
});

// POST /api/talent/candidates/bulk/update
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
  db.prepare(`UPDATE talent_candidates SET ${updates.join(', ')} WHERE id IN (${placeholders}) AND user_id = ?`).run(...params, ...ids, req.user.id);
  res.json({ success: true, count: ids.length });
});

module.exports = router;
