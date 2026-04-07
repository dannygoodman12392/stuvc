const express = require('express');
const router = express.Router();
const db = require('../db');

const DEFAULT_SETTINGS = {
  pipeline_admissions_stages: JSON.stringify([
    { name: 'Sourced', color: 'gray' },
    { name: 'Outreach', color: 'blue' },
    { name: 'First Call Scheduled', color: 'blue' },
    { name: 'First Call Complete', color: 'blue' },
    { name: 'Second Call Scheduled', color: 'amber' },
    { name: 'Second Call Complete', color: 'amber' },
    { name: 'Admitted', color: 'green' },
    { name: 'Active Resident', color: 'green' },
    { name: 'Density Resident', color: 'green' },
    { name: 'Alumni', color: 'gray' },
    { name: 'Hold/Nurture', color: 'amber' },
    { name: 'Not Admitted', color: 'red' },
  ]),
  pipeline_deal_stages: JSON.stringify([
    { name: 'Under Consideration', color: 'blue' },
    { name: 'First Meeting', color: 'blue' },
    { name: 'Partner Call', color: 'amber' },
    { name: 'Memo Draft', color: 'amber' },
    { name: 'IC Review', color: 'amber' },
    { name: 'Committed', color: 'green' },
    { name: 'Passed', color: 'red' },
  ]),
  sourcing_locations: JSON.stringify([]),
  sourcing_schools: JSON.stringify([]),
  sourcing_companies: JSON.stringify([]),
  sourcing_builder_signals: JSON.stringify([]),
  sourcing_domains: JSON.stringify([]),
  sourcing_stage_filter: 'Any',
  sourcing_custom_queries: JSON.stringify([]),
};

// Helper: parse JSON values safely
function parseValue(val) {
  try {
    return JSON.parse(val);
  } catch {
    return val;
  }
}

// GET /api/settings/pipeline-config — convenience endpoint for pipeline stages
// NOTE: Defined BEFORE /:key to prevent Express param matching
router.get('/pipeline-config', (req, res) => {
  const rows = db.prepare(
    "SELECT setting_key, setting_value FROM user_settings WHERE user_id = ? AND setting_key IN ('pipeline_admissions_stages', 'pipeline_deal_stages')"
  ).all(req.user.id);

  const userSettings = {};
  for (const row of rows) {
    userSettings[row.setting_key] = row.setting_value;
  }

  res.json({
    admissions_stages: parseValue(userSettings.pipeline_admissions_stages || DEFAULT_SETTINGS.pipeline_admissions_stages),
    deal_stages: parseValue(userSettings.pipeline_deal_stages || DEFAULT_SETTINGS.pipeline_deal_stages),
  });
});

// GET /api/settings/sourcing-criteria — convenience endpoint for sourcing config
// NOTE: Defined BEFORE /:key to prevent Express param matching
router.get('/sourcing-criteria', (req, res) => {
  const sourcingKeys = [
    'sourcing_locations', 'sourcing_schools', 'sourcing_companies',
    'sourcing_builder_signals', 'sourcing_domains', 'sourcing_stage_filter',
    'sourcing_custom_queries',
  ];

  const rows = db.prepare(
    `SELECT setting_key, setting_value FROM user_settings WHERE user_id = ? AND setting_key IN (${sourcingKeys.map(() => '?').join(',')})`
  ).all(req.user.id, ...sourcingKeys);

  const userSettings = {};
  for (const row of rows) {
    userSettings[row.setting_key] = row.setting_value;
  }

  res.json({
    locations: parseValue(userSettings.sourcing_locations || DEFAULT_SETTINGS.sourcing_locations),
    schools: parseValue(userSettings.sourcing_schools || DEFAULT_SETTINGS.sourcing_schools),
    companies: parseValue(userSettings.sourcing_companies || DEFAULT_SETTINGS.sourcing_companies),
    builder_signals: parseValue(userSettings.sourcing_builder_signals || DEFAULT_SETTINGS.sourcing_builder_signals),
    domains: parseValue(userSettings.sourcing_domains || DEFAULT_SETTINGS.sourcing_domains),
    stage_filter: parseValue(userSettings.sourcing_stage_filter || DEFAULT_SETTINGS.sourcing_stage_filter),
    custom_queries: parseValue(userSettings.sourcing_custom_queries || DEFAULT_SETTINGS.sourcing_custom_queries),
  });
});

// GET /api/settings — all settings for authenticated user
router.get('/', (req, res) => {
  const rows = db.prepare('SELECT setting_key, setting_value FROM user_settings WHERE user_id = ?').all(req.user.id);

  // Start with defaults, overlay user overrides
  const settings = {};
  for (const [key, val] of Object.entries(DEFAULT_SETTINGS)) {
    settings[key] = parseValue(val);
  }
  for (const row of rows) {
    settings[row.setting_key] = parseValue(row.setting_value);
  }

  res.json(settings);
});

// POST /api/settings/complete-onboarding — mark onboarding as done
// NOTE: Defined BEFORE /:key to prevent Express param matching
router.post('/complete-onboarding', (req, res) => {
  // All criteria are optional — users configure what matters to them
  db.prepare('UPDATE users SET onboarding_complete = 1 WHERE id = ?').run(req.user.id);
  res.json({ success: true });
});

// PUT /api/settings/:key — upsert a single setting
router.put('/:key', (req, res) => {
  const { key } = req.params;
  const { value } = req.body;

  if (value === undefined) {
    return res.status(400).json({ error: 'Missing value' });
  }

  const serialized = typeof value === 'string' ? value : JSON.stringify(value);

  db.prepare(`
    INSERT INTO user_settings (user_id, setting_key, setting_value, updated_at)
    VALUES (?, ?, ?, CURRENT_TIMESTAMP)
    ON CONFLICT(user_id, setting_key)
    DO UPDATE SET setting_value = excluded.setting_value, updated_at = CURRENT_TIMESTAMP
  `).run(req.user.id, key, serialized);

  res.json({ key, value: parseValue(serialized) });
});

module.exports = router;
