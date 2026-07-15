// ══════════════════════════════════════════════════════════════════════════
// Re-partition every sourced founder against the canonical Illinois tie gate.
//
// WHY: on 2026-07-15 the inbox held 167 rows, 85 of them on the IL-tied board.
// 55 of those 85 were Stanford / Yale / CMU / Wharton / USC alumni with no
// Illinois connection, because the tie was read from a user setting that merged
// 12 Illinois schools with 36 national ones (see lib/ilTie.js for the full
// autopsy). Two more — George Rose, Kyle Jung — carried "current: Chicago" with
// the word Chicago appearing NOWHERE in their profile. The tie was asserted, not
// verified.
//
// This rewrites list_scope, location_type, and chicago_connection from evidence.
//
// SAFETY:
//   · Nothing is deleted. A row that loses its tie moves to the national Frontier
//     Watch, which is where it should have been. Danny can still see it.
//   · Idempotent — re-running produces the same answer, because the gate reads
//     the PROFILE and never reads chicago_connection back in. (That last part is
//     load-bearing: if it read its own output, "school_alumni: Stanford" would
//     re-verify itself forever and this migration would be a no-op on exactly the
//     rows it exists to fix.)
//   · Prints a full diff and takes --dry by default in the runner below.
//
// RUN: node migrations/repartition-il-ties.js [--apply]
// ══════════════════════════════════════════════════════════════════════════

const db = require('../db');
const { verifyIlTie, propagateCofounderTies, profileText } = require('../lib/ilTie');

function repartition({ apply = false } = {}) {
  const rows = db.prepare('SELECT * FROM sourced_founders').all();

  // Direct ties first, then lend each company's tie to its untied co-founders.
  // A lent tie is typed `cofounder` and its evidence names who it came from, so
  // it can never be mistaken for the person's own.
  const verdicts = propagateCofounderTies(rows, (r) => verifyIlTie(profileText(r)));

  const plan = [];
  for (const r of rows) {
    const tie = verdicts.get(r.id);
    const scope = tie.verified ? 'pipeline' : 'watchlist';

    // The evidence IS the value. "school: Northwestern University — …McCormick
    // School of Engineering…" is auditable; "school_alumni: Stanford" was not,
    // which is the only reason 55 bad rows survived for four months.
    const connection = tie.verified
      ? `${tie.type}: ${tie.place}${tie.evidence ? ` — ${tie.evidence}` : ''}`.slice(0, 400)
      : null;

    const changed =
      r.list_scope !== scope ||
      r.location_type !== (tie.verified ? tie.type : null) ||
      (r.chicago_connection || null) !== connection;

    if (changed) {
      plan.push({
        id: r.id, name: r.name,
        from: { scope: r.list_scope, type: r.location_type, conn: r.chicago_connection },
        to: { scope, type: tie.verified ? tie.type : null, conn: connection },
        reason: tie.verified ? null : tie.reason,
      });
    }
  }

  if (apply) {
    const upd = db.prepare(
      'UPDATE sourced_founders SET list_scope = ?, location_type = ?, chicago_connection = ? WHERE id = ?'
    );
    const tx = db.transaction((items) => {
      for (const p of items) upd.run(p.to.scope, p.to.type, p.to.conn, p.id);
    });
    tx(plan);
  }

  return { total: rows.length, changed: plan.length, plan };
}

// ══════════════════════════════════════════════════════════════════════
// The config half of the fix.
//
// The re-partition above cleans the ROWS. This cleans the CAUSE: one setting
// named `sourcing_schools` doing two incompatible jobs. verifyLocation() reads it
// as "schools that prove an Illinois tie"; the Settings UI and the caliber scorer
// read it as "schools we consider elite." On 2026-07-15 it held 12 Illinois
// schools and 36 national ones, so Stanford proved a Chicago tie.
//
// Splitting it is what stops this regressing. Without it, the next re-ingest
// re-poisons every row the migration just cleaned.
//
// Written by hand, not derived. A substring heuristic put "columbia" (Columbia
// University, NY) into the Illinois bucket because it is a substring of "columbia
// college chicago", and demoted "northwestern kellogg" because the canonical
// entry reads "kellogg school". Quiet classification errors are the whole reason
// this file exists; this list gets read by a human.
// ══════════════════════════════════════════════════════════════════════
const IL_TIE_SCHOOLS = [
  'northwestern university', 'northwestern kellogg', 'northwestern mccormick',
  'university of chicago', 'chicago booth', 'booth school of business',
  'university of illinois', 'university of illinois chicago',
  'illinois urbana-champaign', 'uiuc',
  'illinois institute of technology', 'loyola university chicago',
  'depaul university', 'columbia college chicago',
];

function splitSchoolSettings(userId = 1) {
  const row = db
    .prepare("SELECT setting_value FROM user_settings WHERE setting_key = 'sourcing_schools' AND user_id = ?")
    .get(userId);
  if (!row) return { skipped: 'no sourcing_schools setting' };

  let all;
  try { all = JSON.parse(row.setting_value); } catch { return { skipped: 'unparseable setting' }; }
  if (!Array.isArray(all)) return { skipped: 'setting is not a list' };

  // The tie list is the canonical one, written wholesale — NOT filtered from
  // whatever was there. The old value is the thing that was wrong; intersecting
  // with it would just preserve the mistake.
  const tie = [...IL_TIE_SCHOOLS];
  // Everything the user had that isn't an Illinois school becomes pedigree. Kept,
  // not discarded — "Stanford" is a real caliber signal, just never a location.
  const pedigree = all.filter((s) => !IL_TIE_SCHOOLS.includes(String(s).toLowerCase()));

  const up = db.prepare(
    `INSERT INTO user_settings (user_id, setting_key, setting_value) VALUES (?,?,?)
     ON CONFLICT(user_id, setting_key) DO UPDATE SET setting_value = excluded.setting_value`
  );
  db.transaction(() => {
    up.run(userId, 'sourcing_schools', JSON.stringify(tie));
    // Pedigree is NOT thrown away — "Stanford" is a real and useful caliber signal.
    // It just is not a location, and conflating the two is what broke the board.
    up.run(userId, 'sourcing_pedigree_schools', JSON.stringify(pedigree));
  })();

  return { tie: tie.length, pedigree: pedigree.length, was: all.length };
}

module.exports = { repartition, splitSchoolSettings, IL_TIE_SCHOOLS };

if (require.main === module) {
  const apply = process.argv.includes('--apply');
  const { total, changed, plan } = repartition({ apply });

  const toWatch = plan.filter((p) => p.to.scope === 'watchlist' && p.from.scope === 'pipeline');
  const toPipe = plan.filter((p) => p.to.scope === 'pipeline' && p.from.scope === 'watchlist');

  console.log(`\n${apply ? 'APPLIED' : 'DRY RUN'} — ${total} sourced founders, ${changed} rows change\n`);
  console.log(`  false ties removed from the board : ${toWatch.length}`);
  console.log(`  real ties rescued from watchlist  : ${toPipe.length}\n`);

  if (toWatch.length) {
    console.log('REMOVED FROM THE BOARD (no verified Illinois tie):');
    for (const p of toWatch.slice(0, 12)) {
      console.log(`  ${p.name.padEnd(28)} was "${String(p.from.conn).slice(0, 32)}"`);
    }
    if (toWatch.length > 12) console.log(`  … and ${toWatch.length - 12} more`);
  }
  if (toPipe.length) {
    console.log('\nRESCUED ONTO THE BOARD (real tie, wrongly benched):');
    for (const p of toPipe) console.log(`  ${p.name.padEnd(28)} ${String(p.to.conn).slice(0, 90)}`);
  }
  if (!apply) console.log('\nNothing written. Re-run with --apply to commit.\n');
}
