'use strict';
const { test } = require('node:test');
const assert = require('node:assert');
const { cleanProfileText, isPlausiblePersonName, verbatimIn, verifyTieEvidence } = require('../pipeline/sourcing-engine');

test('cleanProfileText cuts off contamination (other people)', () => {
  const t = 'Jane Doe — founder in Chicago, ex-Stripe. People also viewed: Bob from MIT, Sue from Northwestern.';
  const cleaned = cleanProfileText(t);
  assert.ok(cleaned.includes('Jane Doe'));
  assert.ok(!cleaned.toLowerCase().includes('mit'));
  assert.ok(!cleaned.toLowerCase().includes('northwestern'));
});

test('isPlausiblePersonName accepts real names, rejects garbage', () => {
  assert.ok(isPlausiblePersonName('Sid Sinha'));
  assert.ok(isPlausiblePersonName('Mark Andreessen'));
  assert.ok(isPlausiblePersonName('Ada de Souza'));
  assert.ok(!isPlausiblePersonName('our new product'));
  assert.ok(!isPlausiblePersonName('Introducing Acme'));
  assert.ok(!isPlausiblePersonName('How we built X'));
  assert.ok(!isPlausiblePersonName('stealth founder'));
  assert.ok(!isPlausiblePersonName('Jane')); // single token
  assert.ok(!isPlausiblePersonName('Series A 2024'));
});

test('verbatimIn requires the quote to actually be in the text', () => {
  const text = 'Studied at Northwestern, then founded a fintech startup in Chicago.';
  assert.ok(verbatimIn('founded a fintech startup in Chicago', text));
  assert.ok(!verbatimIn('graduated from MIT with a PhD', text));
  assert.ok(!verbatimIn('short', text)); // too short to be evidence
});

test('verifyTieEvidence needs a verbatim quote naming a real IL signal', () => {
  const text = 'Based in Chicago, building an AI company. Northwestern alum.';
  assert.ok(verifyTieEvidence({ tie_evidence: 'Based in Chicago, building an AI company' }, text));
  assert.ok(!verifyTieEvidence({ tie_evidence: 'building an AI company' }, text)); // no IL token
  assert.ok(!verifyTieEvidence({ tie_evidence: 'lives in Austin Texas' }, text));   // not in text
});
