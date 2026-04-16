const express = require('express');
const router = express.Router();
const db = require('../../db');

// GET /api/talent/trash — consolidated view of soft-deleted talent objects
router.get('/', (req, res) => {
  const u = req.user.id;
  const companies = db.prepare('SELECT id, name, deleted_at, updated_at FROM talent_portfolio_companies WHERE user_id = ? AND is_deleted = 1 ORDER BY deleted_at DESC LIMIT 200').all(u);
  const roles = db.prepare('SELECT id, title, portfolio_company_id, deleted_at FROM talent_roles WHERE user_id = ? AND is_deleted = 1 ORDER BY deleted_at DESC LIMIT 200').all(u);
  const candidates = db.prepare('SELECT id, name, current_company, headline, deleted_at FROM talent_candidates WHERE user_id = ? AND is_deleted = 1 ORDER BY deleted_at DESC LIMIT 200').all(u);
  const matches = db.prepare('SELECT id, candidate_id, role_id, deleted_at FROM talent_matches WHERE user_id = ? AND is_deleted = 1 ORDER BY deleted_at DESC LIMIT 200').all(u);
  res.json({ companies, roles, candidates, matches });
});

const TABLE_MAP = {
  company: 'talent_portfolio_companies',
  role: 'talent_roles',
  candidate: 'talent_candidates',
  match: 'talent_matches',
};

// POST /api/talent/trash/restore — { type, ids }
router.post('/restore', (req, res) => {
  const { type, ids } = req.body || {};
  const table = TABLE_MAP[type];
  if (!table) return res.status(400).json({ error: 'Invalid type' });
  if (!Array.isArray(ids) || ids.length === 0) return res.status(400).json({ error: 'No ids' });

  const placeholders = ids.map(() => '?').join(', ');
  db.prepare(`UPDATE ${table} SET is_deleted = 0, deleted_at = NULL, updated_at = CURRENT_TIMESTAMP WHERE id IN (${placeholders}) AND user_id = ?`).run(...ids, req.user.id);
  res.json({ success: true, count: ids.length });
});

// POST /api/talent/trash/purge — { type, ids } hard delete
router.post('/purge', (req, res) => {
  const { type, ids } = req.body || {};
  const table = TABLE_MAP[type];
  if (!table) return res.status(400).json({ error: 'Invalid type' });
  if (!Array.isArray(ids) || ids.length === 0) return res.status(400).json({ error: 'No ids' });
  const placeholders = ids.map(() => '?').join(', ');
  db.prepare(`DELETE FROM ${table} WHERE id IN (${placeholders}) AND user_id = ? AND is_deleted = 1`).run(...ids, req.user.id);
  res.json({ success: true, count: ids.length });
});

// POST /api/talent/trash/empty — purge everything in trash (older than 0 days; user-initiated full empty)
router.post('/empty', (req, res) => {
  const u = req.user.id;
  let total = 0;
  for (const table of Object.values(TABLE_MAP)) {
    const r = db.prepare(`DELETE FROM ${table} WHERE user_id = ? AND is_deleted = 1`).run(u);
    total += r.changes;
  }
  res.json({ success: true, count: total });
});

module.exports = router;
