'use strict';
const { test } = require('node:test');
const assert = require('node:assert');
const { founderGate } = require('../pipeline/sourcing-engine');

test('rejects a VC whose headline looks innocuous (the Mark Suster case)', () => {
  // Headline scraped from a blog; body reveals the investor identity.
  const r = founderGate('General partner at Upfront Ventures. I invest in early-stage founders and write about venture.', 'our new product');
  assert.strictEqual(r.ok, false);
});

test('rejects an explicit fund partner', () => {
  assert.strictEqual(founderGate('We back founders building the future.', 'Partner at a16z').ok, false);
});

test('rejects a solo angel', () => {
  assert.strictEqual(founderGate('Angel investor. I invest in startups across fintech and AI.', 'Investor & advisor').ok, false);
});

test('accepts a real founder even if they mention their investors', () => {
  const r = founderGate('Founder & CEO building an AI-native TPA. Backed by Chicago Ventures and angels.', 'Co-founder & CEO, stealth');
  assert.strictEqual(r.ok, true);
});

test('accepts an operator-turned-founder', () => {
  const r = founderGate('Just left Stripe to start a company. Building in stealth.', 'Founder, stealth · ex-Stripe');
  assert.strictEqual(r.ok, true);
});
