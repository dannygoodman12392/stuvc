/**
 * Health service — durable job-run logging + a 5-second green/red board.
 * Every job records its outcome via recordJobRun; buildHealthReport reads the latest
 * state of each subsystem so a failure is visible, never swallowed.
 */
const db = require('../db');

function recordJobRun(job, status, detail = '', userId = null) {
  try {
    db.prepare('INSERT INTO job_runs (user_id, job, status, detail) VALUES (?, ?, ?, ?)')
      .run(userId, job, status, String(detail).slice(0, 500));
  } catch (e) {
    console.error('[health] recordJobRun failed:', e.message);
  }
}

function lastRun(job, userId = null) {
  if (userId != null) {
    return db.prepare('SELECT * FROM job_runs WHERE job = ? AND (user_id = ? OR user_id IS NULL) ORDER BY ran_at DESC LIMIT 1').get(job, userId);
  }
  return db.prepare('SELECT * FROM job_runs WHERE job = ? ORDER BY ran_at DESC LIMIT 1').get(job);
}

function readSetting(userId, key) {
  const r = db.prepare('SELECT setting_value FROM user_settings WHERE user_id = ? AND setting_key = ?').get(userId, key);
  return r ? r.setting_value : null;
}

function buildHealthReport(userId) {
  const checks = [];
  const add = (name, status, detail) => checks.push({ name, status, detail });

  // 1. Datastore
  try { db.prepare('SELECT 1 AS ok').get(); add('Database', 'green', 'SQLite connected'); }
  catch (e) { add('Database', 'red', e.message); }

  // 2. API keys (env for user 1, or per-user settings)
  const hasAnthropic = !!(readSetting(userId, 'api_key_anthropic') || (userId === 1 && process.env.ANTHROPIC_API_KEY));
  const hasExa = !!(readSetting(userId, 'api_key_exa') || (userId === 1 && process.env.EXA_API_KEY));
  add('Claude API key', hasAnthropic ? 'green' : 'red', hasAnthropic ? 'configured' : 'missing — scoring/extraction will degrade');
  add('Exa API key (sourcing)', hasExa ? 'green' : 'yellow', hasExa ? 'configured' : 'missing — sourcing runs will no-op');

  // 3. Jobs — last run status
  const jobLabels = {
    newsletter_sync: 'Daily Brief sync',
    sourcing_run: 'Sourcing run',
    talent_sourcing: 'Talent sourcing',
    notion_push: 'Notion mirror push',
    publish_to_team: 'Publish to team (Airtable)',
  };
  for (const [job, label] of Object.entries(jobLabels)) {
    const r = lastRun(job, userId);
    if (!r) { add(label, 'gray', 'never run'); continue; }
    const when = new Date(r.ran_at + 'Z').toLocaleString();
    const color = r.status === 'ok' ? 'green' : r.status === 'partial' ? 'yellow' : 'red';
    add(label, color, `${r.status} · ${when}${r.detail ? ' · ' + r.detail : ''}`);
  }

  // 4. Newsletter source health
  const srcs = db.prepare("SELECT name, last_status FROM newsletter_sources WHERE user_id = ? AND enabled = 1 AND is_deleted = 0").all(userId);
  if (srcs.length) {
    const failing = srcs.filter(s => (s.last_status || '').toLowerCase().startsWith('error'));
    add('Newsletter sources', failing.length ? 'yellow' : 'green',
      `${srcs.length} enabled${failing.length ? ` · ${failing.length} failing: ${failing.map(s => s.name).join(', ')}` : ' · all healthy'}`);
  } else {
    add('Newsletter sources', 'gray', 'none configured');
  }

  // 5. Data integrity quick checks
  const dupes = db.prepare(`
    SELECT COUNT(*) c FROM (
      SELECT LOWER(linkedin_url) u FROM founders
      WHERE created_by = ? AND is_deleted = 0 AND linkedin_url IS NOT NULL AND linkedin_url != ''
      GROUP BY u HAVING COUNT(*) > 1
    )`).get(userId).c;
  add('Duplicate founders', dupes > 0 ? 'yellow' : 'green', dupes > 0 ? `${dupes} LinkedIn duplicate(s)` : 'none');

  const suspect = db.prepare("SELECT COUNT(*) c FROM opportunity_assessments WHERE created_by = ? AND is_deleted = 0 AND deck_status = 'suspect'").get(userId).c;
  add('Assessment decks', suspect > 0 ? 'yellow' : 'green', suspect > 0 ? `${suspect} suspect — re-upload PDF` : 'all ingested cleanly');

  const overall = checks.some(c => c.status === 'red') ? 'red' : checks.some(c => c.status === 'yellow') ? 'yellow' : 'green';
  return { overall, checks, at: new Date().toISOString() };
}

module.exports = { recordJobRun, lastRun, buildHealthReport };
