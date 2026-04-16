const express = require('express');
const router = express.Router();
const db = require('../../db');

const DEFAULTS = {
  talent_bands: ['A', 'B', 'C'],
  talent_locations: [],
  talent_schools: [],
  talent_companies: [],
  talent_stacks: [],
  talent_domains: [],
  talent_leap_signals: [],
  talent_custom_queries: [],
};

function parse(v, fallback) {
  if (v === undefined || v === null) return fallback;
  try { return JSON.parse(v); } catch { return v; }
}

// GET /api/talent/criteria?scope=global
router.get('/', (req, res) => {
  const scope = req.query.scope || 'global';
  const rows = db.prepare('SELECT setting_key, setting_value FROM talent_criteria WHERE user_id = ? AND scope = ?').all(req.user.id, scope);
  const user = {};
  for (const row of rows) user[row.setting_key] = row.setting_value;

  const out = {};
  for (const [k, fallback] of Object.entries(DEFAULTS)) {
    out[k] = parse(user[k], fallback);
  }
  res.json({ scope, ...out });
});

// PUT /api/talent/criteria/:key?scope=global
router.put('/:key', (req, res) => {
  const scope = req.query.scope || 'global';
  const { key } = req.params;
  const { value } = req.body;
  if (value === undefined) return res.status(400).json({ error: 'Missing value' });

  const serialized = typeof value === 'string' ? value : JSON.stringify(value);
  db.prepare(`
    INSERT INTO talent_criteria (user_id, scope, setting_key, setting_value, updated_at)
    VALUES (?, ?, ?, ?, CURRENT_TIMESTAMP)
    ON CONFLICT(user_id, scope, setting_key)
    DO UPDATE SET setting_value = excluded.setting_value, updated_at = CURRENT_TIMESTAMP
  `).run(req.user.id, scope, key, serialized);

  res.json({ key, scope, value: parse(serialized) });
});

// DELETE /api/talent/criteria/:key?scope=global — reset to default
router.delete('/:key', (req, res) => {
  const scope = req.query.scope || 'global';
  db.prepare('DELETE FROM talent_criteria WHERE user_id = ? AND scope = ? AND setting_key = ?').run(req.user.id, scope, req.params.key);
  res.json({ success: true });
});

module.exports = router;
