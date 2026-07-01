'use strict';
const { test } = require('node:test');
const assert = require('node:assert');
const { breakoutScore } = require('../lib/breakoutScore');
const preprogram = require('../pipeline/sources/pre-program-discovery');

// ── breakoutScore ──
test('breakoutScore rewards elite pedigree + prior exit', () => {
  const angelo = breakoutScore('Mathematics & CS @ UChicago. Ex-Jane Street, Citadel. Co-founder, stealth startup.');
  const foosaner = breakoutScore('Working on something new! Founder of Backflip (acquired 2024), ex-Stripe, ex-Amazon.');
  const student = breakoutScore('Economics student. Interested in business.');
  assert.ok(angelo.score >= 40, `elite quant + UChicago + building should score high (${angelo.score})`);
  assert.ok(foosaner.score >= 45, `prior exit + Stripe should score very high (${foosaner.score})`);
  assert.ok(student.score < 15, `thin profile should score low (${student.score})`);
  assert.ok(foosaner.signals.some(s => /exit/i.test(s)), 'exit signal cited as evidence');
  assert.ok(angelo.signals.some(s => /jane street/i.test(s)), 'elite company cited');
});

// ── pre-program connector ──
function mockExa(results) { return async () => ({ results }); }
const RESULTS = [
  { title: 'Angelo Torres - Co-Founder at Stealth | LinkedIn', url: 'https://www.linkedin.com/in/angelo',
    text: 'Mathematics & CS @ University of Chicago. Ex-Jane Street, Citadel. Building a stealth startup.' },
  { title: 'Bob Discovered - Founder | LinkedIn', url: 'https://www.linkedin.com/in/bob',
    text: 'Founder at Acme (YC W25). Building the future.' },                       // has program tag → excluded
  { title: 'Carol Exec - VP at BigCo | LinkedIn', url: 'https://www.linkedin.com/in/carol',
    text: 'VP of Sales at BigCo. University of Chicago alum.' },                     // not building → excluded
];

test('pre-program connector excludes program-tagged + non-builders', async () => {
  const recs = await preprogram.fetch({ keys: { exa: 'k' }, deps: { exaSearch: mockExa(RESULTS) } });
  const names = recs.map(r => r.name);
  assert.ok(names.includes('Angelo Torres'), 'stealth pre-program builder kept');
  assert.ok(!names.some(n => /Bob/.test(n)), 'YC-tagged person excluded (already discovered)');
  assert.ok(!names.some(n => /Carol/.test(n)), 'non-builder exec excluded');
});

test('pre-program connector is dormant without an Exa key', async () => {
  assert.deepEqual(await preprogram.fetch({ keys: {} }), []);
});
