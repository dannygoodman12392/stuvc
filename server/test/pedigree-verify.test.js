'use strict';
const { test } = require('node:test');
const assert = require('node:assert');
const { verifyPedigree } = require('../pipeline/sourcing-engine');

test('drops a school label not present in the profile (the hallucination case)', () => {
  const text = 'Founder building an AI tool in Chicago. Previously a product manager.';
  const kept = verifyPedigree(['MIT', 'Illinois Institute of Technology', 'Northwestern'], text);
  assert.deepStrictEqual(kept, []); // none of these appear in the text
});

test('keeps a school only when its name is genuinely in the text', () => {
  const text = 'Studied computer science at Northwestern University before joining Stripe.';
  const kept = verifyPedigree(['Northwestern', 'MIT', 'Ex-Stripe'], text);
  assert.ok(kept.includes('Northwestern'));
  assert.ok(kept.includes('Ex-Stripe'));
  assert.ok(!kept.includes('MIT'));
});

test('an acronym like MIT must appear as a whole word, not inside another word', () => {
  assert.deepStrictEqual(verifyPedigree(['MIT'], 'Please submit your application to the committee.'), []);
  assert.deepStrictEqual(verifyPedigree(['MIT'], 'She earned her PhD at MIT in 2019.'), ['MIT']);
});

test('multi-word school needs ALL distinctive tokens, not one stray word', () => {
  // "Illinois" appears but not "Institute" — must NOT keep "Illinois Institute of Technology".
  assert.deepStrictEqual(verifyPedigree(['Illinois Institute of Technology'], 'Lives in Illinois, building a startup.'), []);
  assert.deepStrictEqual(verifyPedigree(['Illinois Institute of Technology'], 'Graduated from the Illinois Institute of Technology.'), ['Illinois Institute of Technology']);
});
