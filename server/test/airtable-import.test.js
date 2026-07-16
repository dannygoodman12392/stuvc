'use strict';
const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');

// These tests pin the two rules the 2026-07-16 dry run taught us, plus the bug
// that made the rewrite necessary. All three are about the same failure: a sync
// that quietly does the wrong thing to data Danny maintains by hand.

function read(p) { return fs.readFileSync(path.join(__dirname, '..', p), 'utf8'); }
const SRC = read('services/airtable-import.js');

// ── 1. THE BUG THAT STARTED IT ──
// The old sync hit `skipped++; continue;` for every founder that already existed,
// so four months of Danny's stage changes were fetched and discarded nightly.
// 22 founders he'd declined showed on the board as live prospects.
test('sync updates existing founders — it does not skip them', () => {
  assert.ok(
    /UPDATE founders SET/.test(SRC),
    'the import must be able to UPDATE an existing founder, not only INSERT new ones'
  );
  // The precise shape of the old bug: finding an existing row and bailing.
  assert.ok(
    !/if \(byRecordId\) \{ skipped\+\+; continue; \}/.test(SRC),
    'found the old early-bail on an existing Airtable record id — Airtable edits would never land'
  );
});

// ── 2. TRACKS ARE UNIONED, NEVER REPLACED ──
// Airtable's Pipeline cell not saying "Investment" is not the same as Danny
// deciding a company is off his investment board. The dry run wanted to remove 17.
test('mergeTracks: Airtable can add a track but never remove one', () => {
  const { mergeTracks } = require("../services/airtable-import").__test;

  // The 17-row case: Stu has investment, Airtable doesn't mention it. Keep it.
  assert.strictEqual(
    mergeTracks('admissions,investment', 'admissions'),
    'admissions,investment',
    'Airtable omitting a track must not delete a company from Danny\'s investment board'
  );

  // The 5-row case: Danny ticked Investment in Airtable. Stu must catch up.
  assert.strictEqual(mergeTracks('admissions', 'admissions,investment'), 'admissions,investment');

  // No duplicates, and a blank Stu value is fine.
  assert.strictEqual(mergeTracks('', 'admissions'), 'admissions');
  assert.strictEqual(mergeTracks('admissions', 'admissions'), 'admissions');
  assert.strictEqual(mergeTracks(null, 'admissions,investment'), 'admissions,investment');
});

// ── 3. `source` IS A FALSE FRIEND ──
// Stu's source = who brought them in ("Danny Goodman").
// Airtable's Source = the channel ("Outbound"). Same word, different question.
// Treating them as one column proposed overwriting 93 rows of attribution.
test('source is fill-if-empty, never authoritative', () => {
  const { __test } = require('../services/airtable-import');
  assert.ok(__test, 'test hooks must be exported');

  // Static guard: the constant lists are the contract.
  const auth = SRC.match(/const AUTHORITATIVE = \[([\s\S]*?)\];/);
  const fill = SRC.match(/const FILL_IF_EMPTY = \[([\s\S]*?)\];/);
  assert.ok(auth && fill, 'both ownership lists must exist');
  assert.ok(
    !/'source'/.test(auth[1]),
    'source must NOT be authoritative — Airtable would overwrite 93 rows of attribution with a channel name'
  );
  assert.ok(/'source'/.test(fill[1]), 'source must be fill-if-empty');
  assert.ok(
    !/'pipeline_tracks'/.test(auth[1]),
    'pipeline_tracks must not be authoritative — it is unioned via mergeTracks()'
  );
});

// ── 4. AN EMPTY AIRTABLE CELL MEANS "UNSET", NOT "DELETE WHAT YOU KNOW" ──
test('a blank Airtable value never blanks a populated Stu field', () => {
  assert.ok(
    /if \(isBlank\(next\)\) continue;/.test(SRC),
    'the authoritative loop must skip blank Airtable values rather than write them over Stu data'
  );
});

// ── 5. AIRTABLE'S TWO AXES SURVIVE THE TRIP ──
// "Stage 5: Not Admitted / 1st Mtg Scheduled" is a real, common combination:
// Danny declined them, the courtesy meeting is still on the calendar. Stu's
// single admissions_status cannot hold both, so both are also stored verbatim.
test('desiredFrom keeps Airtable\'s admission status and next step untranslated', () => {
  const { desiredFrom } = require('../services/airtable-import').__test;
  const got = desiredFrom({
    'Founder Name': 'Austin Lee',
    'Admission Status': 'Stage 5: Not Admitted',
    'Next Step Description': '1st Mtg Scheduled',
    'Pipeline': ['Resident'],
  });
  assert.strictEqual(got.airtable_admission_status, 'Stage 5: Not Admitted');
  assert.strictEqual(got.airtable_next_step, '1st Mtg Scheduled');
  // And the derived column resolves to the decision, not the leftover calendar entry.
  assert.strictEqual(got.admissions_status, 'Not Admitted',
    'a declined founder must not read as a live prospect because a meeting is still booked');
});

// ── 6. THE REST API AND THE MCP DISAGREE ABOUT SELECT FIELDS ──
// REST returns a singleSelect as a bare string; other clients return {id,name}.
// sel() must not turn either into "[object Object]".
test('sel normalizes both select shapes', () => {
  const { sel } = require('../services/airtable-import').__test;
  assert.strictEqual(sel('Stage 1: Identified'), 'Stage 1: Identified');
  assert.strictEqual(sel({ id: 'sel1', name: 'Stage 1: Identified' }), 'Stage 1: Identified');
  assert.strictEqual(sel(['Resident', 'Investment']), 'Resident');
  assert.strictEqual(sel(null), null);
  assert.strictEqual(sel('   '), null);
});

// ── 7. TWO AIRTABLE RECORDS MUST NEVER FIGHT OVER ONE STU ROW ──
// Caught by running the sync twice and watching it fail to converge.
//
// Kevin Pierce had two live Airtable records ("Lumitra" / Stage 5 and
// "Lumitra, Inc." / Stage 4). Both matched him by name, so each run rewrote the
// other's answer and his stage flipped nightly between Active Resident and
// Hold/Nurture — whichever record Airtable returned last won.
//
// Rodrigo Mosqueira looked like the same bug and was the opposite one: Stu held
// recs1CLrRhf57htzs, a record Airtable no longer has. A fence that only asked
// "is this row claimed?" would let a DELETED record hold his row hostage forever
// and lock out his real one. Hence: claimed BY A LIVE RECORD.
test('a name match may only claim a row no live Airtable record holds', () => {
  assert.ok(
    /const liveRecordIds = new Set\(records\.map\(r => r\.id\)\)/.test(SRC),
    'the sync must know which record ids Airtable still has'
  );
  assert.ok(
    /heldByLiveRecord\s*=\s*!isBlank\(heldBy\) && liveRecordIds\.has\(heldBy\)/.test(SRC),
    'a claim only counts if the claiming record still exists in Airtable'
  );
  assert.ok(
    /if \(candidate && !heldByLiveRecord\)/.test(SRC),
    'a name match may adopt a row that is unclaimed OR claimed by a deleted record'
  );
  assert.ok(/conflicts\.push\(/.test(SRC),
    'a row held by a different LIVE record must be reported, not silently rewritten');

  // The old unfenced fallback: assigning straight from a bare name lookup.
  assert.ok(
    !/existing = db\.prepare\(\s*'SELECT \* FROM founders WHERE is_deleted = 0 AND LOWER\(TRIM\(name\)\) = LOWER\(\?\)'\s*\)\.get\(name\);/.test(SRC),
    'found an unfenced name-only match — two Airtable records could claim one Stu row'
  );
});

// ── 8. THIS IS A ONE-WAY READ ──
// Airtable is the team's shared base. Nothing here may write back up to it.
test('the import never writes to Airtable', () => {
  assert.ok(!/method:\s*'(PATCH|POST|PUT|DELETE)'/.test(SRC),
    'airtable-import.js must only ever GET — writes belong to airtable-sync.js behind its explicit-publish gate');
});
