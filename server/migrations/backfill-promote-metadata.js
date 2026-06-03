/**
 * backfill-promote-metadata
 * =========================
 * Founders promoted before metadata was carried on approval lost their sourcing evidence
 * (caliber, signals, evidence_map, red flags). Where the source sourced_founders row still
 * exists (promoted_to_founder_id link), copy that evidence back — only filling NULLs.
 */
const db = require('../db');

function run() {
  const promoted = db.prepare(`
    SELECT promoted_to_founder_id AS fid, id AS sid,
           caliber_tier, caliber_score, caliber_signals, evidence_map, red_flags
    FROM sourced_founders WHERE promoted_to_founder_id IS NOT NULL
  `).all();
  const upd = db.prepare(`
    UPDATE founders SET
      caliber_tier   = COALESCE(caliber_tier, ?),
      caliber_score  = COALESCE(caliber_score, ?),
      caliber_signals= COALESCE(caliber_signals, ?),
      evidence_map   = COALESCE(evidence_map, ?),
      red_flags      = COALESCE(red_flags, ?),
      sourced_from_id= COALESCE(sourced_from_id, ?)
    WHERE id = ?
  `);
  let n = 0;
  const tx = db.transaction(() => {
    for (const p of promoted) {
      if (!p.fid) continue;
      upd.run(p.caliber_tier, p.caliber_score, p.caliber_signals, p.evidence_map, p.red_flags, p.sid, p.fid);
      n++;
    }
  });
  tx();
  console.log(`[backfill-promote-metadata] backfilled sourcing evidence for ${n} promoted founders`);
}

module.exports = run;
