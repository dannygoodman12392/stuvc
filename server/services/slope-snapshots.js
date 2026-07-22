'use strict';
// Weekly memory for the sourcing pool: capture each founder's current signal state so
// slope on non-timestamped signals (followers, stage, tier) becomes computable as a
// delta run-over-run, and the engine accumulates its own time series. See db.js
// founder_signal_snapshots and pipeline/github-activity computeGithubSlope.

const db = require('../db');
const ff = require('../lib/founderFit');

function captureSnapshots({ userId = 1 } = {}) {
  const rows = db.prepare(
    "SELECT * FROM sourced_founders WHERE user_id = ? AND status IN ('pending','starred')"
  ).all(userId);

  const ins = db.prepare(`
    INSERT INTO founder_signal_snapshots
      (sourced_founder_id, user_id, github_slope_score, github_total_stars, github_last30,
       caliber_tier, fit_tier, stage, marker_keys)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);

  const tx = db.transaction((list) => {
    let n = 0;
    for (const r of list) {
      const f = ff.evaluate(r);
      let stars = null, last30 = null;
      try { const d = JSON.parse(r.github_slope_data || '{}'); stars = d.total_stars ?? null; last30 = d.last30 ?? null; } catch { /* no gh data */ }
      ins.run(r.id, userId, r.github_slope_score ?? null, stars, last30, r.caliber_tier ?? null, f.tier, f.stage, JSON.stringify(f.markers.map((m) => m.key)));
      n++;
    }
    return n;
  });
  return { captured: tx(rows) };
}

// The delta since a founder's previous snapshot — "what changed" — for the movers
// view. Returns null if there's no prior snapshot to compare against yet.
function movementFor(sourcedFounderId) {
  const snaps = db.prepare(
    'SELECT * FROM founder_signal_snapshots WHERE sourced_founder_id = ? ORDER BY captured_at DESC LIMIT 2'
  ).all(sourcedFounderId);
  if (snaps.length < 2) return null;
  const [now, prev] = snaps;
  return {
    slope_delta: (now.github_slope_score ?? 0) - (prev.github_slope_score ?? 0),
    stars_delta: (now.github_total_stars ?? 0) - (prev.github_total_stars ?? 0),
    tier_changed: now.fit_tier !== prev.fit_tier ? { from: prev.fit_tier, to: now.fit_tier } : null,
    since: prev.captured_at,
  };
}

module.exports = { captureSnapshots, movementFor };
