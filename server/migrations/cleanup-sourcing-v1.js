/**
 * cleanup-sourcing-v1
 * ===================
 * One-time pass over the existing sourced-founders inbox to apply the new sourcing
 * methodology to history:
 *   1. Drop non-founders (investors, fund/accelerator staff, recruiters) via the founder gate.
 *   2. Collapse duplicates — keep one row per person (best caliber, then fit), dismiss the rest.
 *   3. Re-score caliber (S/A/B/C) deterministically from the stored profile text.
 *
 * Only touches inbox rows (status pending/starred). Removed rows are set to 'dismissed'
 * (recoverable), never hard-deleted.
 */
const db = require('../db');
const {
  founderGate, computeCaliber, hasDisqualifyingFlag, linkedinSlug, normName,
} = require('../pipeline/sourcing-engine');

const TIER_RANK = { S: 4, A: 3, B: 2, C: 1 };

function safeParse(v, fallback) {
  if (v == null) return fallback;
  try { return JSON.parse(v); } catch { return fallback; }
}

function profileText(row) {
  const raw = safeParse(row.raw_data, {});
  return { headline: row.headline || raw.headline || '', text: raw.text || '' };
}

function run() {
  const dismiss = db.prepare("UPDATE sourced_founders SET status = 'dismissed' WHERE id = ?");
  const setCaliber = db.prepare(
    'UPDATE sourced_founders SET caliber_tier = ?, caliber_score = ?, caliber_rationale = ?, caliber_signals = ? WHERE id = ?'
  );

  const users = db.prepare("SELECT DISTINCT user_id FROM sourced_founders WHERE status IN ('pending','starred')").all();
  let totalNonFounder = 0, totalDupes = 0, totalRescored = 0;

  const tx = db.transaction(() => {
    for (const { user_id } of users) {
      const rows = db.prepare(
        "SELECT * FROM sourced_founders WHERE user_id = ? AND status IN ('pending','starred')"
      ).all(user_id);

      // 1. Founder gate
      const survivors = [];
      for (const r of rows) {
        const { headline, text } = profileText(r);
        const gate = founderGate(text, headline);
        if (!gate.ok) { dismiss.run(r.id); totalNonFounder++; continue; }
        survivors.push(r);
      }

      // 2. Dedupe — group by linkedin slug, else normalized name
      const groups = new Map();
      for (const r of survivors) {
        const key = linkedinSlug(r.linkedin_url) ? `li:${linkedinSlug(r.linkedin_url)}` : `nm:${normName(r.name)}`;
        if (!groups.has(key)) groups.set(key, []);
        groups.get(key).push(r);
      }
      const kept = [];
      for (const group of groups.values()) {
        if (group.length === 1) { kept.push(group[0]); continue; }
        // Keep the strongest: caliber tier, then confidence, then earliest id.
        group.sort((a, b) =>
          (TIER_RANK[b.caliber_tier] || 0) - (TIER_RANK[a.caliber_tier] || 0)
          || (b.confidence_score || 0) - (a.confidence_score || 0)
          || a.id - b.id
        );
        kept.push(group[0]);
        for (const dupe of group.slice(1)) { dismiss.run(dupe.id); totalDupes++; }
      }

      // 3. Re-score caliber on the survivors
      for (const r of kept) {
        const { headline, text } = profileText(r);
        const elite = safeParse(r.elite_schools_national, []);
        const redFlags = safeParse(r.red_flags, []);
        const det = computeCaliber(text, headline, elite);
        let { tier, score, signals, rationale } = det;
        if (hasDisqualifyingFlag(redFlags)) { tier = 'C'; score = Math.min(3, score); rationale = `Red-flagged. ${rationale}`; }
        setCaliber.run(tier, score, rationale, JSON.stringify(signals), r.id);
        totalRescored++;
      }
    }
  });
  tx();

  console.log(`[cleanup-sourcing-v1] dismissed ${totalNonFounder} non-founders, ${totalDupes} duplicates; re-scored ${totalRescored} survivors across ${users.length} user(s).`);
}

module.exports = run;
