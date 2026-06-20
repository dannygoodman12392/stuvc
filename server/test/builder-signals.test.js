'use strict';
const { test } = require('node:test');
const assert = require('node:assert');
const { detectSignals, filterBySignals, listSignals, VALID_SIGNAL_KEYS } = require('../lib/builderSignals');

test('catalog lists signals and filters by product', () => {
  const all = listSignals();
  assert.ok(all.length >= 6);
  const talent = listSignals('talent').map(s => s.key);
  assert.ok(talent.includes('just_departed'));
  assert.ok(!talent.includes('fresh_incorporation')); // sourcing-only
});

test('just_departed fires on structured recency and respects the YC filter', () => {
  const ycLeaver = { name: 'A', departure_recency_months: 3, builder_signals: JSON.stringify(['YC Alum']), headline: 'ex-Founder' };
  const r = detectSignals(ycLeaver, { types: ['just_departed'], opts: { just_departed: { fromTier: 'yc' } } });
  assert.equal(r.matched.length, 1);
  assert.ok(r.matched[0].confidence > 0.7);

  // Same person, but require they came from a unicorn factory → should NOT match (no factory co).
  const r2 = detectSignals(ycLeaver, { types: ['just_departed'], opts: { just_departed: { fromTier: 'factory' } } });
  assert.equal(r2.matched.length, 0);
});

test('just_departed does not fire on a stale departure', () => {
  const stale = { name: 'B', departure_recency_months: 24, headline: 'ex-Founder at Foo' };
  const r = detectSignals(stale, { types: ['just_departed'], opts: { just_departed: { maxMonths: 9 } } });
  assert.equal(r.matched.length, 0);
});

test('founder_factory_alum needs BOTH a factory company and an early-role marker', () => {
  const founding = { name: 'C', headline: 'Founding Engineer at Stripe' };
  assert.equal(detectSignals(founding, { types: ['founder_factory_alum'] }).matched.length, 1);

  const lateHire = { name: 'D', headline: 'Senior Engineer at Stripe' }; // factory but not early
  assert.equal(detectSignals(lateHire, { types: ['founder_factory_alum'] }).matched.length, 0);

  const earlyNonFactory = { name: 'E', headline: 'Founding Engineer at NoNameCo' }; // early but not factory
  assert.equal(detectSignals(earlyNonFactory, { types: ['founder_factory_alum'] }).matched.length, 0);
});

test('stealth + repeat-founder detectors fire on text cues, with evidence', () => {
  const row = { name: 'F', headline: 'Building something new (stealth)', bio: 'Second-time founder, previous exit acquired by Google' };
  const r = detectSignals(row, { types: ['stealth_building', 'repeat_founder'] });
  const keys = r.matched.map(m => m.key);
  assert.ok(keys.includes('stealth_building'));
  assert.ok(keys.includes('repeat_founder'));
  assert.ok(r.matched.every(m => m.evidence.length > 0)); // every hit carries evidence
});

test('filterBySignals any-mode and all-mode behave correctly', () => {
  const rows = [
    { name: 'unicorn', departure_recency_months: 2, headline: 'ex-Founding Engineer at Ramp, building something new' },
    { name: 'noise', headline: 'Marketing manager at a bank' },
  ];
  const any = filterBySignals(rows, { types: ['just_departed', 'stealth_building'], mode: 'any' });
  assert.equal(any.length, 1);
  assert.equal(any[0].row.name, 'unicorn');

  const all = filterBySignals(rows, { types: ['just_departed', 'stealth_building'], mode: 'all' });
  assert.equal(all.length, 1); // the unicorn row matches both

  // The unicorn row carries no elite-credential marker, so requiring it in all-mode drops everything.
  const allStrict = filterBySignals(rows, { types: ['just_departed', 'credentialed_outlier'], mode: 'all' });
  assert.equal(allStrict.length, 0);
});

test('top accelerators (a16z Speedrun, Z Fellows, Founders Inc) are recognized', () => {
  for (const accel of ['a16z Speedrun', 'Z Fellows', 'Founders Inc']) {
    const row = { name: 'A', headline: `Co-founder, ${accel} '25`, tenure_months: 3 };
    const r = detectSignals(row, { types: ['fresh_incorporation'] });
    assert.equal(r.matched.length, 1, `${accel} should drive fresh_incorporation`);
  }
});

test('every signal key is detectable and returns a stable shape', () => {
  for (const key of VALID_SIGNAL_KEYS) {
    const r = detectSignals({ name: 'x' }, { types: [key] });
    assert.ok(Array.isArray(r.matched));
    assert.equal(typeof r.topConfidence, 'number');
  }
});
