'use strict';
// ══════════════════════════════════════════════════════════════════════════
// One-time: fold the two co-founder rows Danny named into their company's card.
//
// Danny: "There are a few companies where there are multiple entries, it tends to be
// for companies we've invested in (Eric Mills and Scott Nelson are both showing for
// Permute, and Kyle DeSana and Ehren are showing for Siftree, for example). Could we
// just have Scott and Kyle kept in?"
//
// These are not duplicates. They're co-founders, and Airtable is right to hold both
// — its Founder Ecosystem table is one row per PERSON, because residency is per
// person. Stu's board is one card per COMPANY, so it folds them.
//
// ── ONLY THE TWO HE NAMED ──
// Seven other companies also have co-founder rows (August, Auvi Labs, Bolto,
// ClearCOGS, Keep it Cool, Mondo, Wizard Perks). They are NOT touched here. Danny
// picked Scott and Kyle by name; picking a "primary" for the other seven is his
// call, not a rule I can infer — and every one of them is terminal (Hold/Nurture or
// Legacy Not Admitted) with no notes or signals on either row, so nothing is
// hurting while they wait. He can fold them from the card.
//
// ── AND NEVER BY COMPANY NAME ALONE ──
// "Stealth" and "Not Yet" are form placeholders, not companies. Three unrelated
// founders share "Not Yet" (Julian Rockwood, Darren Peng, Mark Khoury) and 18 share
// "Stealth". A rule that folded rows by matching company name would merge strangers
// into one card and quietly delete two live relationships from the board.
//
// Matched by NAME, not by hardcoded row id: ids differ between the dev copy and
// production, and a migration that silently folds the wrong founder because an id
// drifted is worse than one that folds nobody.
// ══════════════════════════════════════════════════════════════════════════

const db = require('./db');

// [company, keep, fold] — exactly as Danny named them.
const PAIRS = [
  ['Permute', 'Scott Nelson', 'Eric Mills'],
  ['Siftree', 'Kyle Desana', 'Ehren Marschall'],
];

function backfillCofounders({ dryRun = false } = {}) {
  const out = { folded: [], skipped: [] };

  for (const [company, keepName, foldName] of PAIRS) {
    const find = (name) => db.prepare(`
      SELECT id, name, company, represented_by_founder_id FROM founders
      WHERE is_deleted = 0 AND LOWER(TRIM(company)) = LOWER(?) AND LOWER(TRIM(name)) = LOWER(?)
    `).get(company, name);

    const keep = find(keepName);
    const fold = find(foldName);

    if (!keep || !fold) {
      out.skipped.push({ company, reason: `could not find ${!keep ? keepName : foldName}` });
      continue;
    }
    if (fold.represented_by_founder_id === keep.id) {
      out.skipped.push({ company, reason: 'already folded' });
      continue;
    }
    if (!dryRun) {
      db.prepare('UPDATE founders SET represented_by_founder_id = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?')
        .run(keep.id, fold.id);
    }
    out.folded.push({ company, kept: `${keep.name} #${keep.id}`, folded: `${fold.name} #${fold.id}` });
  }
  return out;
}

module.exports = backfillCofounders;

if (require.main === module) {
  const r = backfillCofounders({ dryRun: process.argv.includes('--dry') });
  for (const f of r.folded) console.log(`[Cofounders] ${f.company}: kept ${f.kept}, folded ${f.folded}`);
  for (const s of r.skipped) console.log(`[Cofounders] ${s.company}: skipped — ${s.reason}`);
}
