/**
 * monitorData.js — scoped CRUD for signal monitors and their hits.
 * Shared by the MCP tools and the REST /api/monitors routes so both stay in sync.
 */
const db = require('./../db');
const { MONITOR_TYPES } = require('../pipeline/monitor-engine');

function createMonitor(userId, { type, label = null, config = null } = {}) {
  if (!MONITOR_TYPES[type]) {
    const valid = Object.keys(MONITOR_TYPES).join(', ');
    throw Object.assign(new Error(`Unknown monitor type "${type}". Valid: ${valid}`), { status: 400 });
  }
  // All monitors run on the single daily cron; the monitors.schedule column keeps its
  // 'daily' default (reserved for per-monitor cadence later).
  const cfg = config ? (typeof config === 'string' ? config : JSON.stringify(config)) : null;
  const info = db.prepare(
    'INSERT INTO monitors (user_id, type, label, config_json) VALUES (?, ?, ?, ?)'
  ).run(userId, type, label || MONITOR_TYPES[type].label, cfg);
  return getMonitor(userId, info.lastInsertRowid);
}

function getMonitor(userId, id) {
  return db.prepare('SELECT * FROM monitors WHERE id = ? AND user_id = ? AND is_deleted = 0').get(parseInt(id), userId);
}

function listMonitors(userId) {
  const monitors = db.prepare(
    'SELECT * FROM monitors WHERE user_id = ? AND is_deleted = 0 ORDER BY created_at DESC'
  ).all(userId);
  // Attach undismissed-hit counts so the UI/agent can show "3 new".
  return monitors.map(m => ({
    ...m,
    new_hits: db.prepare('SELECT COUNT(*) c FROM monitor_hits WHERE monitor_id = ? AND dismissed = 0').get(m.id).c,
  }));
}

function setEnabled(userId, id, enabled) {
  const info = db.prepare('UPDATE monitors SET enabled = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ? AND user_id = ?')
    .run(enabled ? 1 : 0, parseInt(id), userId);
  return info.changes > 0;
}

function deleteMonitor(userId, id) {
  const info = db.prepare('UPDATE monitors SET is_deleted = 1 WHERE id = ? AND user_id = ?').run(parseInt(id), userId);
  return info.changes > 0;
}

function listHits(userId, { monitorId = null, sinceDays = null, includeDismissed = false, limit = 50 } = {}) {
  const params = [userId];
  let sql = 'SELECT * FROM monitor_hits WHERE user_id = ?';
  if (monitorId) { sql += ' AND monitor_id = ?'; params.push(parseInt(monitorId)); }
  if (!includeDismissed) sql += ' AND dismissed = 0';
  if (sinceDays) { sql += " AND detected_at >= datetime('now', ?)"; params.push(`-${parseInt(sinceDays)} days`); }
  sql += ' ORDER BY detected_at DESC LIMIT ?';
  params.push(Math.min(parseInt(limit) || 50, 200));
  return db.prepare(sql).all(...params).map(h => ({
    ...h,
    payload: (() => { try { return JSON.parse(h.payload_json); } catch { return null; } })(),
  }));
}

function dismissHit(userId, hitId) {
  const info = db.prepare('UPDATE monitor_hits SET dismissed = 1 WHERE id = ? AND user_id = ?').run(parseInt(hitId), userId);
  return info.changes > 0;
}

module.exports = { createMonitor, getMonitor, listMonitors, setEnabled, deleteMonitor, listHits, dismissHit };
