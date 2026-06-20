/**
 * monitor-engine.js — runs signal monitors and records hits.
 *
 * Each monitor is one configured builder-signal watch (e.g. "YC founders who just
 * left"). A run evaluates the monitor's signal type(s) over the user's universe and
 * records NEW matches as monitor_hits (deduped per entity). Same engine, many types —
 * "YC just left" is just one row in MONITOR_TYPES.
 *
 * MVP universe = the user's own sourced_founders + talent_candidates (so a monitor
 * surfaces matches across everything Stu has already pulled for them). The structure
 * leaves a clean seam to add active discovery (e.g. scraping the YC directory) later:
 * a monitor type just needs to contribute rows to `gatherUniverse`.
 */
const db = require('./../db');
const { detectSignals } = require('../lib/builderSignals');

// type → which builder signals define a hit, with detector opts, applicable sources,
// and a coarse intent label for the alert.
const MONITOR_TYPES = {
  yc_departure: {
    label: 'YC founder just left',
    signals: ['just_departed'], opts: { just_departed: { fromTier: 'yc', maxMonths: 12 } },
    sources: ['sourcing', 'talent'], intent: 'starting_or_open',
  },
  factory_departure: {
    label: 'Founder-factory early employee just left',
    signals: ['just_departed', 'founder_factory_alum'], opts: { just_departed: { fromTier: 'factory', maxMonths: 12 } },
    sources: ['sourcing', 'talent'], intent: 'open_to_join',
  },
  stealth: {
    label: 'Building something new (stealth)',
    signals: ['stealth_building'], opts: {},
    sources: ['sourcing', 'talent'], intent: 'starting_new',
  },
  repeat_founder: {
    label: 'Repeat founder back in the market',
    signals: ['repeat_founder'], opts: {},
    sources: ['sourcing', 'talent'], intent: 'starting_new',
  },
  formation: {
    label: 'Fresh incorporation',
    signals: ['fresh_incorporation'], opts: {},
    sources: ['sourcing'], intent: 'starting_new',
  },
  breakout_builder: {
    label: 'Breakout builder',
    signals: ['breakout_builder'], opts: {},
    sources: ['sourcing', 'talent'], intent: 'open_to_join',
  },
};

function listMonitorTypes() {
  return Object.entries(MONITOR_TYPES).map(([key, v]) => ({
    key, label: v.label, signals: v.signals, sources: v.sources,
  }));
}

const SOURCED_COLS = `id, name, company, role, headline, linkedin_url, github_url,
  pedigree_signals, builder_signals, departure_recency_months, github_activity_score, caliber_tier`;
const CAND_COLS = `id, name, headline, current_company AS company, current_role AS role,
  linkedin_url, github_url, pedigree_signals, builder_signals, leap_signals,
  tenure_months, departure_recency_months`;

// Gather the universe of profiles for a monitor (user-scoped). Recent rows first.
function gatherUniverse(userId, def, lookbackDays) {
  const rows = [];
  const since = `-${Math.max(1, lookbackDays)} days`;
  if (def.sources.includes('sourcing')) {
    db.prepare(
      `SELECT ${SOURCED_COLS}, 'sourcing' AS _src FROM sourced_founders
       WHERE user_id = ? AND created_at >= datetime('now', ?)`
    ).all(userId, since).forEach(r => rows.push(r));
  }
  if (def.sources.includes('talent')) {
    db.prepare(
      `SELECT ${CAND_COLS}, 'talent' AS _src FROM talent_candidates
       WHERE user_id = ? AND is_deleted = 0 AND created_at >= datetime('now', ?)`
    ).all(userId, since).forEach(r => rows.push(r));
  }
  return rows;
}

// Canonical entity key — MUST match how stored hits are keyed below (url, else name),
// so an entity with no LinkedIn/GitHub URL is still deduped across runs.
function entityKey(row) {
  return (row.linkedin_url || row.github_url || row.name || '').toLowerCase().trim();
}

// Run a single monitor. Returns { scanned, newHits }.
// Default lookback spans the whole base (dedup prevents re-alerting); a monitor's
// config_json.lookbackDays can narrow it.
function runMonitor(monitor, { lookbackDays = 3650 } = {}) {
  const def = MONITOR_TYPES[monitor.type];
  if (!def) return { scanned: 0, newHits: 0, error: `unknown monitor type: ${monitor.type}` };

  let cfg = {};
  try { cfg = monitor.config_json ? JSON.parse(monitor.config_json) : {}; } catch {}
  const minConfidence = cfg.minConfidence ?? 0;

  const universe = gatherUniverse(monitor.user_id, def, cfg.lookbackDays || lookbackDays);

  // Entities already recorded for this monitor — never re-alert the same person.
  const seen = new Set(
    db.prepare('SELECT entity_url, entity_name FROM monitor_hits WHERE monitor_id = ?')
      .all(monitor.id)
      .map(h => (h.entity_url || h.entity_name || '').toLowerCase().trim())
  );

  const insert = db.prepare(
    `INSERT INTO monitor_hits (monitor_id, user_id, entity_name, entity_url, signal_type, payload_json, intent, confidence)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
  );

  let newHits = 0;
  const tx = db.transaction((rows) => {
    for (const row of rows) {
      const key = entityKey(row);
      if (seen.has(key)) continue;
      const { matched } = detectSignals(row, { types: def.signals, source: row._src, opts: def.opts });
      const passing = matched.filter(m => m.confidence >= minConfidence);
      // 'all' semantics for multi-signal types (e.g. factory_departure needs both).
      const ok = def.signals.every(s => passing.some(m => m.key === s));
      if (!ok) continue;

      const top = passing[0];
      const payload = {
        source: row._src,
        company: row.company || null,
        role: row.role || null,
        departure_recency_months: row.departure_recency_months ?? null,
        signals: passing,
      };
      insert.run(
        monitor.id, monitor.user_id, row.name || 'Unknown',
        row.linkedin_url || row.github_url || null,
        // the highest-confidence matched signal (payload.signals has the full set)
        (top && top.key) || def.signals[0], JSON.stringify(payload), def.intent, Math.round((top?.confidence || 0) * 100)
      );
      seen.add(key);
      newHits++;
    }
  });
  tx(universe);

  db.prepare('UPDATE monitors SET last_run_at = CURRENT_TIMESTAMP WHERE id = ?').run(monitor.id);
  return { scanned: universe.length, newHits };
}

// Active monitors (config_json.active = true) go FETCH fresh people from the web before
// scanning, so an alert like "YC founder just left" surfaces brand-new departures, not
// only people already in the account. Discovery runs on the user's Exa key + spend cap;
// failures (no key / over cap) degrade gracefully to a local-only scan.
async function maybeDiscover(monitor, def) {
  let cfg = {}; try { cfg = monitor.config_json ? JSON.parse(monitor.config_json) : {}; } catch {}
  if (!cfg.active) return {};
  try {
    const { discover } = require('./discovery-engine');
    const target = (def.sources.includes('talent') && !def.sources.includes('sourcing')) ? 'talent' : 'sourcing';
    const r = await discover({ userId: monitor.user_id, signals: def.signals, opts: def.opts, target, persist: true, limit: cfg.discoverLimit || 25 });
    return { discovered: r.persisted };
  } catch (e) {
    return { discovered: 0, discoverError: e.message };
  }
}

// Run one monitor, optionally discovering first. Returns { scanned, newHits, discovered? }.
async function runMonitorWithDiscovery(monitor, runOpts = {}) {
  const def = MONITOR_TYPES[monitor.type];
  const disc = def ? await maybeDiscover(monitor, def) : {};
  return { ...runMonitor(monitor, runOpts), ...disc };
}

async function runUserMonitors(userId) {
  const monitors = db.prepare('SELECT * FROM monitors WHERE user_id = ? AND enabled = 1 AND is_deleted = 0').all(userId);
  const results = [];
  for (const m of monitors) results.push({ monitor: m.id, type: m.type, ...(await runMonitorWithDiscovery(m)) });
  return results;
}

// Cron entry: run every enabled monitor across all users.
async function runAllMonitors() {
  const userIds = db.prepare('SELECT DISTINCT user_id FROM monitors WHERE enabled = 1 AND is_deleted = 0').all().map(r => r.user_id);
  let totalNew = 0;
  for (const uid of userIds) {
    const res = await runUserMonitors(uid);
    totalNew += res.reduce((s, r) => s + (r.newHits || 0), 0);
  }
  return { users: userIds.length, totalNew };
}

module.exports = { MONITOR_TYPES, listMonitorTypes, runMonitor, runMonitorWithDiscovery, runUserMonitors, runAllMonitors };
