'use strict';
const { test } = require('node:test');
const assert = require('node:assert');
const E = require('../pipeline/sourcing-engine');

const CRITERIA = {
  locations: ['chicago', 'illinois', 'evanston', 'naperville', 'oak park', 'champaign', 'urbana'],
  schools: ['university of illinois', 'uiuc', 'northwestern', 'university of chicago', 'uchicago', 'iit', 'kellogg', 'booth', 'loyola', 'depaul'],
};

// Mirror the real intake order: tie gate → tie-type → founder gate → stage filter.
function decide(p) {
  const il = E.verifyLocation(p.text, p.headline, CRITERIA);
  if (!il.verified || !E.VALID_TIE_TYPES.includes(il.type)) return 'REJECT';
  if (!E.founderGate(p.text, p.headline).ok) return 'REJECT';
  if (E.isTooFarAlong(p.text, p.headline).disqualified) return 'REJECT';
  return 'ACCEPT';
}

const CASES = [
  ['no IL tie (Stanford/SF)', { headline: 'Founder, stealth | San Francisco', text: 'Stanford CS grad building AI in SF.' }, 'REJECT'],
  ['sports-team false tie', { headline: 'Founder | building in SF', text: 'Huge Chicago Bears superfan. Stealth startup in San Francisco.' }, 'REJECT'],
  ['media false tie', { headline: 'Founder | SF', text: 'Featured in the Chicago Tribune. Building in San Francisco.' }, 'REJECT'],
  ['IL school alum elsewhere', { headline: 'Co-founder, stealth | NYC', text: 'Northwestern University alum building fintech.' }, 'ACCEPT'],
  ['current Evanston founder', { headline: 'Founder, stealth · Evanston, IL', text: 'Building vertical SaaS.' }, 'ACCEPT'],
  ['investor with Chicago tie', { headline: 'Partner at a16z | Chicago', text: 'We back founders. Based in Chicago, Illinois.' }, 'REJECT'],
  ['non-founder engineer w/ tie', { headline: 'Software Engineer at Google | Naperville, IL', text: 'I write backend systems at Google.' }, 'REJECT'],
  ['hometown founder', { headline: 'Co-founder & CEO | building fintech', text: 'Grew up in Chicago. Building a payments startup.' }, 'ACCEPT'],
  ['MIT Tech Review, no IL tie', { headline: 'Founder | Austin, TX', text: 'Named to MIT Technology Review 35 Under 35. Building in Austin.' }, 'REJECT'],
  ['UIUC PhD founder Champaign', { headline: 'Founder, commercializing research · Champaign, IL', text: 'PhD at University of Illinois, building deep tech.' }, 'ACCEPT'],
];

for (const [name, profile, expected] of CASES) {
  test(`IL-tie gate: ${name} → ${expected}`, () => {
    assert.strictEqual(decide(profile), expected);
  });
}
