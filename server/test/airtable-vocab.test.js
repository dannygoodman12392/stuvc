'use strict';
const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const vocab = require('../lib/airtableVocab');

// The merged board speaks Airtable's words. These tests exist because the last
// time Stu kept its own vocabulary and mapped onto Airtable's, the mapping quietly
// destroyed four months of Danny's stage changes.

function read(p) { return fs.readFileSync(path.join(__dirname, '..', p), 'utf8'); }

// ── 1. THE STAGE LIST IS AIRTABLE'S, EXACTLY ──
// Verbatim from the live base schema (appfE9DVrSUOrkkpu / tblWkJzy5qpw7FP2M,
// field fldhgAoYfpmvy4Skh) on 2026-07-16. If Airtable 422s a stage push, this is
// the first place to look: an option was added or renamed in the Airtable UI.
test('STAGES matches Airtable\'s Admission Status options exactly', () => {
  assert.deepStrictEqual(vocab.STAGES, [
    'Stage 0: Legacy (Density)',
    'Stage 1: Identified',
    'Stage 2: Interviewed',
    'Stage 3: Evaluating (Investment-Only)',
    'Stage 3: Evaluating (Resident-Only)',
    'Stage 3: Evaluating (Investment + Resident)',
    'Stage 4: Admitted (Resident)',
    'Stage 4: Admitted (Resident + Investment)',
    'Stage 5: Hold / Nurture',
    'Stage 5: Not Admitted',
    'Stage 5: Legacy Density Not Admitted SSFI',
    'Stage 5: Pass on Investment',
  ]);
  assert.deepStrictEqual(vocab.TRACKS, ['Resident', 'Investment']);
});

// ── 2. THE CLIENT MUST NOT KEEP ITS OWN COPY ──
// The stage list ships to the browser in the /api/pipeline response. A second
// hard-coded list in the client is a second thing to drift, which is the entire
// reason the old DEAL_STAGES/ADMISSIONS_STAGES constants were deleted.
test('the client holds no hard-coded stage list', () => {
  const src = fs.readFileSync(
    path.join(__dirname, '..', '..', 'client', 'src', 'pages', 'Pipeline.jsx'), 'utf8'
  );
  assert.ok(!/^const DEAL_STAGES = \[/m.test(src), 'DEAL_STAGES is back in the client');
  assert.ok(!/^const ADMISSIONS_STAGES = \[/m.test(src), 'ADMISSIONS_STAGES is back in the client');
  assert.ok(/data\.vocab\?\.stages/.test(src), 'the board must take its stages from the server payload');
});

// ── 3. THE TRACK TRANSLATION ROUNDTRIPS ──
// Stu stores 'admissions'; Airtable says 'Resident'. Same thing, two words. This
// is the only mapping in the file and it has to be lossless in both directions.
test('track translation roundtrips losslessly', () => {
  assert.deepStrictEqual(vocab.tracksFromStu('admissions,investment'), ['Resident', 'Investment']);
  assert.deepStrictEqual(vocab.tracksFromStu('investment'), ['Investment']);
  assert.deepStrictEqual(vocab.tracksFromStu(''), []);
  assert.deepStrictEqual(vocab.tracksFromStu(null), []);

  assert.strictEqual(vocab.tracksToStu(['Resident', 'Investment']), 'admissions,investment');
  // Storage order is canonical, so a badge toggled in either order stores the same
  // string — otherwise 'investment,admissions' and 'admissions,investment' would
  // look like a change to the sync's diff and rewrite the row every night.
  assert.strictEqual(vocab.tracksToStu(['Investment', 'Resident']), 'admissions,investment');
  assert.strictEqual(vocab.tracksToStu([]), '');
  assert.strictEqual(vocab.tracksToStu(['Nonsense']), '');

  for (const csv of ['admissions', 'investment', 'admissions,investment', '']) {
    assert.strictEqual(vocab.tracksToStu(vocab.tracksFromStu(csv)), csv, `roundtrip failed for ${csv}`);
  }
});

// ── 4. EVERY DERIVED STAGE IS A REAL AIRTABLE OPTION ──
// The 26 Investment-Pipeline orphans get a stage derived from deal_status. If that
// map produced a string Airtable doesn't have, the card would sit in a phantom
// column and any push would 422.
test('DEAL_STATUS_TO_STAGE only ever produces real Airtable stages', () => {
  for (const [deal, stage] of Object.entries(vocab.DEAL_STATUS_TO_STAGE)) {
    assert.ok(vocab.isStage(stage), `deal_status "${deal}" maps to "${stage}", which Airtable does not have`);
  }
});

// ── 5. TERMINAL STAGES ARE REAL, AND ARE THE RIGHT ONES ──
// 22 founders Danny had declined showed as live prospects because nothing knew
// which stages mean "over". Anything counting live pipeline reads this list.
test('terminal stages are real stages and cover the declined outcomes', () => {
  for (const s of vocab.TERMINAL_STAGES) assert.ok(vocab.isStage(s), `${s} is not a real stage`);
  assert.ok(vocab.isTerminal('Stage 5: Not Admitted'));
  assert.ok(vocab.isTerminal('Stage 5: Pass on Investment'));
  // Hold/Nurture is NOT terminal — it's Danny's largest live cohort (45 cards) and
  // counting it as dead would hide the deals most likely to come back.
  assert.ok(!vocab.isTerminal('Stage 5: Hold / Nurture'));
  assert.ok(!vocab.isTerminal('Stage 1: Identified'));
});

// ── 6. THE PUSH PAYLOAD ──
// Tested with a stub, deliberately. The standing rule is that agents don't write to
// the team's shared base, and that includes whatever is running these tests — the
// live round-trip belongs to Danny dragging a card. What CAN be checked offline is
// the part most likely to be wrong: that we address the right field by id and send
// a value Airtable's select will accept rather than 422 on.
test('pushStage sends the Admission Status field id and the exact stage string', async () => {
  const sync = require('../services/airtable-sync');
  const calls = [];
  const patch = async (table, rec, fields) => { calls.push({ table, rec, fields }); return {}; };
  const founder = { id: 1, name: 'T', airtable_founder_record_id: 'recX', stage_status: 'Stage 1: Identified' };

  const r = await sync.pushStage(founder, 'Stage 2: Interviewed', { explicit: true, patch });
  assert.strictEqual(r.pushed, true);
  assert.strictEqual(calls.length, 1);
  assert.strictEqual(calls[0].table, vocab.FOUNDER_TABLE);
  assert.strictEqual(calls[0].rec, 'recX');
  // Field ID, not name: renaming the column in Airtable's UI must not break the write.
  assert.deepStrictEqual(calls[0].fields, { [vocab.FIELD.ADMISSION_STATUS]: 'Stage 2: Interviewed' });
});

test('pushTracks sends the Pipeline field id as an array of real options', async () => {
  const sync = require('../services/airtable-sync');
  const calls = [];
  const patch = async (table, rec, fields) => { calls.push({ table, rec, fields }); return {}; };
  const founder = { id: 1, name: 'T', airtable_founder_record_id: 'recX', pipeline_tracks: 'admissions' };

  await sync.pushTracks(founder, ['Resident', 'Investment'], { explicit: true, patch });
  assert.deepStrictEqual(calls[0].fields, { [vocab.FIELD.PIPELINE]: ['Resident', 'Investment'] });

  // Junk never reaches Airtable — a multi-select rejects unknown options outright.
  calls.length = 0;
  await sync.pushTracks(founder, ['Resident', 'Nonsense'], { explicit: true, patch });
  assert.deepStrictEqual(calls[0].fields, { [vocab.FIELD.PIPELINE]: ['Resident'] });

  // Clearing every badge is a real, intended state: it's how Danny takes a company
  // off both tracks, and the nightly union can only stop re-adding a track if the
  // removal actually reaches Airtable.
  calls.length = 0;
  await sync.pushTracks(founder, [], { explicit: true, patch });
  assert.deepStrictEqual(calls[0].fields, { [vocab.FIELD.PIPELINE]: [] });
});

test('a stage Airtable does not have never reaches the network', async () => {
  const sync = require('../services/airtable-sync');
  let called = false;
  const patch = async () => { called = true; return {}; };
  const founder = { id: 1, name: 'T', airtable_founder_record_id: 'recX' };

  // The OLD board's vocabulary. If this ever got through it would 422.
  const r = await sync.pushStage(founder, 'Under Consideration', { explicit: true, patch });
  assert.strictEqual(r.skipped, 'not_a_valid_stage');
  assert.strictEqual(called, false);
});

test('the gate still refuses a push without explicit:true, stub or not', async () => {
  const sync = require('../services/airtable-sync');
  let called = false;
  const patch = async () => { called = true; return {}; };
  const founder = { id: 1, name: 'T', airtable_founder_record_id: 'recX' };

  assert.deepStrictEqual(await sync.pushStage(founder, 'Stage 2: Interviewed', { patch }), { skipped: 'not_explicit' });
  assert.deepStrictEqual(await sync.pushTracks(founder, ['Resident'], { patch }), { skipped: 'not_explicit' });
  assert.strictEqual(called, false, 'a non-explicit call must not touch the network at all');
});

test('an orphan with no Airtable record is skipped, not errored', async () => {
  const sync = require('../services/airtable-sync');
  let called = false;
  const patch = async () => { called = true; return {}; };
  // One of the 26 from Airtable's separate Investment Pipeline table.
  const orphan = { id: 2, name: 'Deskpilot (Company)', airtable_founder_record_id: null };
  const r = await sync.pushStage(orphan, 'Stage 2: Interviewed', { explicit: true, patch });
  assert.deepStrictEqual(r, { skipped: 'no_airtable_record' });
  assert.strictEqual(called, false);
});

// ── 7. ONLY A HUMAN DRAG MAY WRITE TO AIRTABLE ──
// Danny chose "Drag in Stu, and it writes to Airtable". That relaxes the rule for
// HIS action, not for background jobs. The gate stays; the two board endpoints are
// the only callers allowed through it.
test('explicit Airtable writes come only from the two board endpoints', () => {
  const pipeline = read('routes/pipeline.js');
  const stage = pipeline.match(/router\.patch\('\/:id\/stage'[\s\S]*?\n\}\);/);
  const tracks = pipeline.match(/router\.patch\('\/:id\/tracks'[\s\S]*?\n\}\);/);
  assert.ok(stage && /explicit: true/.test(stage[0]), 'the stage drag must push explicitly');
  assert.ok(tracks && /explicit: true/.test(tracks[0]), 'the badge toggle must push explicitly');

  // No scheduled job may pass the flag.
  for (const f of ['index.js', 'services/airtable-import.js']) {
    assert.ok(!/explicit:\s*true/.test(read(f)), `${f} must never pass explicit:true — agents do not write to Airtable`);
  }
});
