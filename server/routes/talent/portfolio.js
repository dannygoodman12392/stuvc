const express = require('express');
const router = express.Router();
const db = require('../../db');

const FIELDS = [
  'name', 'website_url', 'sector', 'stage', 'one_liner',
  'founder_name', 'founder_email', 'logo_url', 'hq_location',
  'remote_policy', 'notes', 'status'
];

// GET /api/talent/portfolio — list all portfolio companies
router.get('/', (req, res) => {
  const { search, status } = req.query;
  let where = 'user_id = ? AND is_deleted = 0';
  const params = [req.user.id];
  if (status && status !== 'all') { where += ' AND status = ?'; params.push(status); }
  if (search) { where += ' AND (name LIKE ? OR one_liner LIKE ? OR sector LIKE ?)'; const q = `%${search}%`; params.push(q, q, q); }

  const rows = db.prepare(`
    SELECT c.*,
      (SELECT COUNT(*) FROM talent_roles r WHERE r.portfolio_company_id = c.id AND r.is_deleted = 0 AND r.status = 'open') as open_roles,
      (SELECT COUNT(*) FROM talent_roles r WHERE r.portfolio_company_id = c.id AND r.is_deleted = 0) as total_roles,
      (SELECT COUNT(*) FROM talent_matches m JOIN talent_roles r ON m.role_id = r.id WHERE r.portfolio_company_id = c.id AND m.is_deleted = 0 AND m.status = 'suggested') as pending_matches
    FROM talent_portfolio_companies c
    WHERE ${where}
    ORDER BY updated_at DESC
  `).all(...params);

  res.json(rows);
});

// GET /api/talent/portfolio/:id
router.get('/:id', (req, res) => {
  const row = db.prepare('SELECT * FROM talent_portfolio_companies WHERE id = ? AND user_id = ? AND is_deleted = 0').get(req.params.id, req.user.id);
  if (!row) return res.status(404).json({ error: 'Not found' });

  const roles = db.prepare('SELECT * FROM talent_roles WHERE portfolio_company_id = ? AND is_deleted = 0 ORDER BY priority DESC, created_at DESC').all(req.params.id);
  res.json({ ...row, roles });
});

// POST /api/talent/portfolio
router.post('/', (req, res) => {
  const body = req.body || {};
  if (!body.name || !body.name.trim()) return res.status(400).json({ error: 'Name is required' });

  const cols = ['user_id', ...FIELDS];
  const vals = [req.user.id, ...FIELDS.map(f => body[f] ?? null)];
  const placeholders = cols.map(() => '?').join(', ');

  const result = db.prepare(`INSERT INTO talent_portfolio_companies (${cols.join(', ')}) VALUES (${placeholders})`).run(...vals);
  const row = db.prepare('SELECT * FROM talent_portfolio_companies WHERE id = ?').get(result.lastInsertRowid);
  res.json(row);
});

// PUT /api/talent/portfolio/:id — supports partial updates (inline edit)
router.put('/:id', (req, res) => {
  const existing = db.prepare('SELECT * FROM talent_portfolio_companies WHERE id = ? AND user_id = ? AND is_deleted = 0').get(req.params.id, req.user.id);
  if (!existing) return res.status(404).json({ error: 'Not found' });

  const updates = [];
  const params = [];
  for (const field of FIELDS) {
    if (field in req.body) {
      updates.push(`${field} = ?`);
      params.push(req.body[field]);
    }
  }
  if (updates.length === 0) return res.json(existing);

  updates.push('updated_at = CURRENT_TIMESTAMP');
  params.push(req.params.id, req.user.id);

  db.prepare(`UPDATE talent_portfolio_companies SET ${updates.join(', ')} WHERE id = ? AND user_id = ?`).run(...params);
  const row = db.prepare('SELECT * FROM talent_portfolio_companies WHERE id = ?').get(req.params.id);
  res.json(row);
});

// DELETE /api/talent/portfolio/:id — soft delete
router.delete('/:id', (req, res) => {
  const existing = db.prepare('SELECT id FROM talent_portfolio_companies WHERE id = ? AND user_id = ? AND is_deleted = 0').get(req.params.id, req.user.id);
  if (!existing) return res.status(404).json({ error: 'Not found' });

  db.prepare('UPDATE talent_portfolio_companies SET is_deleted = 1, deleted_at = CURRENT_TIMESTAMP WHERE id = ? AND user_id = ?').run(req.params.id, req.user.id);
  // Cascade soft-delete to roles
  db.prepare('UPDATE talent_roles SET is_deleted = 1, deleted_at = CURRENT_TIMESTAMP WHERE portfolio_company_id = ? AND user_id = ? AND is_deleted = 0').run(req.params.id, req.user.id);
  res.json({ success: true });
});

// POST /api/talent/portfolio/bulk/delete — bulk soft delete
router.post('/bulk/delete', (req, res) => {
  const ids = Array.isArray(req.body?.ids) ? req.body.ids.filter(Number.isInteger) : [];
  if (ids.length === 0) return res.status(400).json({ error: 'No ids' });
  const placeholders = ids.map(() => '?').join(', ');
  db.prepare(`UPDATE talent_portfolio_companies SET is_deleted = 1, deleted_at = CURRENT_TIMESTAMP WHERE id IN (${placeholders}) AND user_id = ?`).run(...ids, req.user.id);
  db.prepare(`UPDATE talent_roles SET is_deleted = 1, deleted_at = CURRENT_TIMESTAMP WHERE portfolio_company_id IN (${placeholders}) AND user_id = ? AND is_deleted = 0`).run(...ids, req.user.id);
  res.json({ success: true, count: ids.length });
});

module.exports = router;
