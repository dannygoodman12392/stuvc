'use strict';
// The falsifiable learning loop. When the engine flags a founder Must-meet, it
// pre-commits one dated, binary prediction. Resolving those over time is the only way
// to know if the engine beats chance — the quant red-teamer's point, mapped onto
// Danny's existing Decision-Journal discipline (a dated, checkable claim, always).

const db = require('../db');
const ff = require('../lib/founderFit');

// resolveBy is passed in (YYYY-MM-DD, ~18 months out) because cron-safe contexts here
// can't construct a Date; the caller stamps it. If absent, the prediction is open with
// no deadline — still better than nothing, but the caller should supply one.
function captureForMustMeet({ userId = 1, resolveBy = null } = {}) {
  const rows = db.prepare(
    "SELECT * FROM sourced_founders WHERE user_id = ? AND status IN ('pending','starred')"
  ).all(userId);

  const ins = db.prepare(`
    INSERT OR IGNORE INTO founder_predictions
      (sourced_founder_id, user_id, resolve_by, tier_at_prediction, claim)
    VALUES (?, ?, ?, 'must-meet', ?)
  `);
  let created = 0;
  const tx = db.transaction((list) => {
    for (const r of list) {
      const f = ff.evaluate(r);
      if (f.tier !== 'must-meet') continue;
      const claim = `${r.name || 'This founder'} will raise a priced seed/pre-seed from a top-quartile lead by ${resolveBy || 'the resolve date'}.`;
      const res = ins.run(r.id, userId, resolveBy, claim); // UNIQUE → one per founder, ever
      if (res.changes) created++;
    }
  });
  tx(rows);
  return { created };
}

// Open predictions whose resolve_by has passed — Danny's "score me" queue.
function due({ userId = 1, today = null } = {}) {
  const rows = db.prepare(`
    SELECT p.id, p.sourced_founder_id, p.claim, p.resolve_by, p.predicted_at,
           f.name, f.company, f.github_url
    FROM founder_predictions p
    JOIN sourced_founders f ON f.id = p.sourced_founder_id
    WHERE p.user_id = ? AND p.outcome IS NULL
    ORDER BY p.resolve_by
  `).all(userId);
  if (!today) return rows;
  return rows.filter((r) => r.resolve_by && r.resolve_by <= today);
}

// The scoreboard: of resolved predictions, how many came true. The engine's precision,
// as a real number instead of a story.
function scoreboard({ userId = 1 } = {}) {
  const rows = db.prepare(
    "SELECT outcome, COUNT(*) n FROM founder_predictions WHERE user_id = ? AND outcome IS NOT NULL GROUP BY outcome"
  ).all(userId);
  const by = Object.fromEntries(rows.map((r) => [r.outcome, r.n]));
  const raised = by.raised || 0, not = by.not || 0, resolved = raised + not;
  const open = db.prepare("SELECT COUNT(*) n FROM founder_predictions WHERE user_id = ? AND outcome IS NULL").get(userId).n;
  return { open, resolved, raised, not, precision: resolved ? Math.round((100 * raised) / resolved) / 100 : null };
}

function resolve({ id, userId = 1, outcome }) {
  if (!['raised', 'not', 'skip'].includes(outcome)) throw new Error('outcome must be raised | not | skip');
  const r = db.prepare(
    "UPDATE founder_predictions SET outcome = ?, resolved_at = CURRENT_TIMESTAMP WHERE id = ? AND user_id = ?"
  ).run(outcome, id, userId);
  return { updated: r.changes };
}

module.exports = { captureForMustMeet, due, scoreboard, resolve };
