'use strict';
const { test } = require('node:test');
const assert = require('node:assert');
const { rowSignals, scoreAffinity } = require('../pipeline/taste');

// rowSignals must namespace each attribute so domains/pedigree/etc. never collide,
// and must read the exact columns the divergence flag passes in.
test('rowSignals namespaces and tokenizes a founder row', () => {
  const sig = rowSignals({
    tags: JSON.stringify(['Fintech', 'AI']),
    pedigree_signals: JSON.stringify(['ex-Stripe']),
    builder_signals: JSON.stringify(['repeat founder']),
    caliber_signals: JSON.stringify(['exit']),
    location_type: 'lives_here',
    caliber_tier: 'A',
  });
  assert.ok(sig.includes('domain:fintech'));
  assert.ok(sig.includes('ped:ex-stripe'));
  assert.ok(sig.includes('bld:repeat founder'));
  assert.ok(sig.includes('cal:exit'));
  assert.ok(sig.includes('tie:lives_here'));
  assert.ok(sig.includes('tier:A'));
});

test('rowSignals tolerates empty/malformed JSON', () => {
  assert.deepStrictEqual(rowSignals({ tags: null, pedigree_signals: 'oops' }), []);
});

// scoreAffinity is the engine behind the divergence verdict: positive weights on
// matched signals push affinity up, negative weights push it down.
test('scoreAffinity reflects the sign of learned weights', () => {
  const row = { tags: JSON.stringify(['fintech']), caliber_tier: 'A' };
  const favored = scoreAffinity(row, { 'domain:fintech': 0.4, 'tier:A': 0.3 });
  assert.ok(favored.affinity > 0, 'favored signals → positive affinity');
  assert.ok(favored.hits.includes('fintech'));

  const disfavored = scoreAffinity(row, { 'domain:fintech': -0.4, 'tier:A': -0.3 });
  assert.ok(disfavored.affinity < 0, 'disfavored signals → negative affinity');
});

test('scoreAffinity is neutral with no learned weights', () => {
  assert.strictEqual(scoreAffinity({ tags: '[]' }, {}).affinity, 0);
});
