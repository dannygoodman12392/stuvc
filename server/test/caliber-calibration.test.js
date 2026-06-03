'use strict';
const { test } = require('node:test');
const assert = require('node:assert');
const { computeCaliber } = require('../pipeline/sourcing-engine');

const tier = (text, schools = []) => computeCaliber(text, '', schools).tier;

// THE LENIENCY FIX: a bare credential is no longer best-of-best.
test('a lone elite-company credential (no building) is B, not A', () => {
  assert.strictEqual(tier('Software engineer, previously at Google. Now starting something.'), 'B');
});

test('an elite SCHOOL alone is pedigree, not caliber → C', () => {
  // Stanford passed as an elite national school, nothing else in the text.
  assert.strictEqual(tier('Founder exploring ideas.', ['Stanford']), 'C');
});

test('a credential PAIRED with active building reaches A', () => {
  assert.strictEqual(tier('Ex-Google engineer. Raised a pre-seed round and shipping our first product.'), 'A');
});

// The institutional-raise signal — the validator Danny tracks — is now detected.
test('raising institutional capital alone is a real signal → B', () => {
  assert.strictEqual(tier('Founder building an AI tool. Backed by Chicago Ventures.'), 'B');
});

test('raised seed + elite background → A (the Sid Sinha archetype)', () => {
  assert.strictEqual(tier('Building an AI-native TPA for health benefits. Raised our seed round. Previously at McKinsey.', ['Harvard']), 'A');
});

// Proven outcomes still earn the top tiers.
test('strong traction earns A with no badge', () => {
  assert.strictEqual(tier('Bootstrapped to $3M ARR with 200 paying customers.'), 'A');
});

test('a meaningful prior exit is S', () => {
  assert.strictEqual(tier('Previously founded a startup that was acquired by Stripe for $40M. Now building again.'), 'S');
});

test('thin profile with no outcome or building is C', () => {
  assert.strictEqual(tier('Passionate builder. Excited about the future of AI.'), 'C');
});

// Guard against false positives in the raise detector.
test('"raised awareness" does NOT count as an institutional raise', () => {
  const r = computeCaliber('Raised awareness for mental health. Raised the bar on design.', '', []);
  assert.ok(!r.signals.includes('Raised institutional capital'));
  assert.strictEqual(r.tier, 'C');
});
