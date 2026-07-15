const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');

// ══════════════════════════════════════════════════════════════════════════
// The funnel stage is DERIVED, never stored.
//
// Every one of Danny's 7 portfolio companies still carries
// deal_status = 'Under Consideration' — the field was never touched after the
// money moved. So any stage read from deal_status is a stage that lies, and the
// only durable fact is the recorded check.
//
// Danny, 2026-07-15: "If we invest in a company before I assess, that's ok."
// So `invested` is terminal and wins outright — a portfolio company is never
// chased for a read.
// ══════════════════════════════════════════════════════════════════════════

const SRC = fs.readFileSync(path.join(__dirname, '..', 'routes', 'pipeline.js'), 'utf8');

// Lift the pure functions out of the route module (it needs express + auth to load).
const stageOf = new Function(`${SRC.match(/function stageOf\(r\) \{[\s\S]*?\n\}/)[0]}; return stageOf;`)();
const personName = new Function(`${SRC.match(/function personName\(row\) \{[\s\S]*?\n\}/)[0]}; return personName;`)();

test('an invested company is `invested`, even with a stale deal_status', () => {
  // Prizm's real shape on 2026-07-15.
  const r = { company: 'Prizm', deal_status: 'Under Consideration', investment_amount: 245000 };
  assert.equal(stageOf(r), 'invested');
});

test('invested wins over every other stage', () => {
  const base = { deal_status: 'Under Consideration', investment_amount: 150000 };
  assert.equal(stageOf({ ...base, stu_band: 'memo' }), 'invested');
  assert.equal(stageOf({ ...base, my_band: 'anchor' }), 'invested');
  assert.equal(stageOf({ ...base, stu_band: 'memo', my_band: 'anchor' }), 'invested');
});

test('the rest of the funnel still resolves in order', () => {
  assert.equal(stageOf({ my_band: 'pass', stu_band: 'monitor', deal_status: 'Under Consideration' }), 'decided');
  assert.equal(stageOf({ stu_band: 'monitor', deal_status: 'Under Consideration' }), 'assessed');
  assert.equal(stageOf({ deal_status: 'Under Consideration' }), 'met');
  assert.equal(stageOf({ deal_status: null }), 'found');
});

// The regression this file exists for: PIPELINE_SQL didn't SELECT
// investment_amount, so stageOf read undefined, `undefined > 0` was false, and
// every portfolio company rendered as "met". The board showed "Invested 0" while
// the attention engine — checking the same fact in SQL — correctly found all 9.
// A derived stage is only as honest as the columns it's derived from.
test('PIPELINE_SQL selects every column stageOf depends on', () => {
  for (const col of ['investment_amount', 'deal_status']) {
    assert.ok(
      new RegExp(`f\\.${col}\\b`).test(SRC),
      `PIPELINE_SQL must select f.${col} — stageOf() reads it, and a missing column fails SILENTLY as a wrong stage`
    );
  }
});

test('a zero or null check is not an investment', () => {
  assert.notEqual(stageOf({ deal_status: 'Under Consideration', investment_amount: 0 }), 'invested');
  assert.notEqual(stageOf({ deal_status: 'Under Consideration', investment_amount: null }), 'invested');
});

// ── The import wrote companies into the founders table ──
test('"<Company> (Company)" is not a person', () => {
  assert.equal(personName({ name: 'Prizm (Company)', company: 'Prizm' }), null);
  assert.equal(personName({ name: 'Permute', company: 'Permute' }), null);
  assert.equal(personName({ name: 'Sid Sinha', company: 'Avant Health' }), 'Sid Sinha');
  assert.equal(personName({ name: '', company: 'Foo' }), null);
});
