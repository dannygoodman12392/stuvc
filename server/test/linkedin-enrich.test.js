'use strict';
const { test } = require('node:test');
const assert = require('node:assert');
const { assessProfile, runLinkedInEnrichment } = require('../pipeline/linkedin-enrich');

const IL = { locations: ['chicago', 'aurora', 'illinois', 'evanston', 'champaign'], schools: ['university of chicago', 'uchicago', 'university of illinois', 'uiuc', 'northwestern'] };

test('assessProfile promotes a buried IL tie (the Jensen/Aurora case)', () => {
  // Sourced from Speedrun with a company-focused bio (no IL tie surfaced), but his LinkedIn says it:
  const profile = { city: 'Aurora', state: 'Illinois', headline: 'Founder & CEO at Crebit',
    occupation: 'CEO', experiences: [{ title: 'CEO', company: 'Crebit' }],
    education: [{ school: 'Oswego East High School' }] };
  const a = assessProfile(profile, IL);
  assert.ok(a.tie.verified, 'LinkedIn location surfaces the Illinois tie');
  assert.equal(a.tie.type, 'current');
  assert.ok(a.isFounder, 'CEO/Founder → a real founder');
});

test('assessProfile flags a professor as non-founder even when IL-tied', () => {
  const profile = { city: 'Champaign', state: 'Illinois', headline: 'Professor of Chemistry, University of Illinois',
    occupation: 'Professor', experiences: [{ title: 'Professor', company: 'UIUC' }],
    education: [{ school: 'University of Illinois' }] };
  const a = assessProfile(profile, IL);
  assert.ok(a.tie.verified, 'still IL-tied');
  assert.equal(a.isFounder, false, 'professor is not a pre-seed founder');
  assert.match(a.roleFlag, /Professor/);
});

test('assessProfile leaves a non-IL founder unpromoted', () => {
  const profile = { city: 'San Francisco', state: 'California', headline: 'Co-founder & CEO at Acme',
    experiences: [{ title: 'CEO', company: 'Acme' }], education: [{ school: 'Stanford University' }] };
  const a = assessProfile(profile, IL);
  assert.equal(a.tie.verified, false, 'no IL tie → stays on the watchlist');
  assert.ok(a.isFounder);
});

test('runLinkedInEnrichment is dormant without an EnrichLayer key', async () => {
  const r = await runLinkedInEnrichment({ userId: 1, deps: { enrichKey: null } });
  assert.equal(r.skipped, 'no EnrichLayer key');
});
