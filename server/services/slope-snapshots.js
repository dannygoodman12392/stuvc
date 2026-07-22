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

// The MOVERS — who accelerated, and who newly crossed into a tier, since the last
// snapshot. The red team's "catch the inflection" made concrete: not "who is high"
// but "who is RISING". Compares each founder's two most recent snapshots and returns
// only the ones that actually moved, biggest jump first.
function movers({ userId = 1, limit = 40 } = {}) {
  // Latest two snapshots per founder; the delta between them is the movement.
  const pairs = db.prepare(`
    WITH ranked AS (
      -- id DESC as the tiebreaker: two snapshots captured in the same second (or a
      -- manual double-run) must still order by which was inserted later.
      SELECT s.*, ROW_NUMBER() OVER (PARTITION BY sourced_founder_id ORDER BY captured_at DESC, id DESC) AS rn
      FROM founder_signal_snapshots s WHERE user_id = ?
    )
    SELECT cur.sourced_founder_id AS id,
      cur.github_slope_score AS slope_now, prev.github_slope_score AS slope_prev,
      cur.github_total_stars AS stars_now, prev.github_total_stars AS stars_prev,
      cur.fit_tier AS tier_now, prev.fit_tier AS tier_prev, prev.captured_at AS since
    FROM ranked cur
    JOIN ranked prev ON prev.sourced_founder_id = cur.sourced_founder_id AND prev.rn = 2
    WHERE cur.rn = 1
  `).all(userId);

  const rank = { 'must-meet': 2, strong: 1 };
  const out = [];
  for (const p of pairs) {
    const slopeDelta = (p.slope_now || 0) - (p.slope_prev || 0);
    const starsDelta = (p.stars_now || 0) - (p.stars_prev || 0);
    const tierUp = (rank[p.tier_now] || 0) > (rank[p.tier_prev] || 0);
    if (slopeDelta <= 0 && starsDelta <= 0 && !tierUp) continue; // only movers
    const f = db.prepare('SELECT name, company, github_url FROM sourced_founders WHERE id = ?').get(p.id);
    if (!f) continue;
    out.push({
      id: p.id, name: f.name, company: f.company, github_url: f.github_url,
      slope_delta: slopeDelta, slope_now: p.slope_now,
      stars_delta: starsDelta, tier_now: p.tier_now,
      tier_up: tierUp ? { from: p.tier_prev, to: p.tier_now } : null,
      since: p.since,
    });
  }
  // Biggest jump first: a tier promotion, then slope delta, then star delta.
  out.sort((a, b) =>
    (Number(!!b.tier_up) - Number(!!a.tier_up)) ||
    (b.slope_delta - a.slope_delta) ||
    (b.stars_delta - a.stars_delta));
  return out.slice(0, limit);
}

module.exports = { captureSnapshots, movementFor, movers };
