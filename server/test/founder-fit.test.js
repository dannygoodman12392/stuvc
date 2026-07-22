'use strict';
const { test } = require('node:test');
const assert = require('node:assert');
const ff = require('../lib/founderFit');

// The rubric decides who Danny meets. Every case below is one of his stated rules or
// a false positive that real data actually produced.

// ── STAGE GATE — the current company must be earliest-stage ──
test('a Series A on the current company fails the stage gate', () => {
  const v = ff.evaluate({ headline: 'CEO at Fernstone', raw_data: JSON.stringify({ bio: 'Building Fernstone, raised our Series A last year.' }) });
  assert.equal(v.stageTooLate, true);
  assert.equal(v.stage, 'past-earliest');
  assert.equal(v.meetWorthy, false, 'past-earliest can never be meet-worthy');
});

test('the Cargado case: a closed seed WITH traction on the current co is too late', () => {
  const v = ff.evaluate({ raw_data: JSON.stringify({ bio: 'Founder of Cargado. We raised a seed round and now have 40 paying customers.' }) });
  assert.equal(v.stageTooLate, true, 'seed + traction on the current company is past earliest');
});

test('a PRE-seed raise is exactly what he wants — never disqualified', () => {
  const v = ff.evaluate({ raw_data: JSON.stringify({ bio: 'Stealth founder. Just raised a pre-seed round. Building something new.' }) });
  assert.equal(v.stageTooLate, false);
  assert.equal(v.stage, 'earliest');
});

test('a PRIOR raise is a background win, not a current-stage disqualifier', () => {
  // "previously raised $10M" describes a past company — it must READ as a marker,
  // and must NOT make the current (stealth) company look late.
  const v = ff.evaluate({ raw_data: JSON.stringify({ bio: 'Now in stealth. Previously raised $12M Series A for my last company, which was acquired.' }) });
  assert.equal(v.stageTooLate, false, 'a prior raise must not fail the current-stage gate');
  assert.ok(v.why.includes('Exited a startup') || v.why.some((w) => /Exited/.test(w)), 'the acquisition should surface as a marker');
});

// ── OUTLIER MARKERS — Danny's exact list, and his weighting ──
test('a good exit outranks prior founding, as Danny stated', () => {
  const exit = ff.MARKERS.find((m) => m.key === 'prior_exit').weight;
  const founding = ff.MARKERS.find((m) => m.key === 'prior_founding').weight;
  assert.ok(exit > founding, 'exit must weigh more than prior founding — "better to me than previous founding experience"');
});

test('elite IL school alone does NOT make the shortlist', () => {
  // "went to a prestigious IL school AND have a track record" — the school is a
  // modifier, not a qualifier.
  const v = ff.evaluate({ raw_data: JSON.stringify({ bio: 'Studied at Northwestern. Building in stealth.' }) });
  assert.ok(v.markers.some((m) => m.key === 'il_elite_school'), 'the school should be detected');
  assert.equal(v.meetWorthy, false, 'a school with no core marker is not someone he asked to meet');
});

test('school PLUS a core marker IS meet-worthy, and the school boosts priority', () => {
  const v = ff.evaluate({ raw_data: JSON.stringify({ bio: 'YC alum. Studied at the University of Chicago. Building in stealth.' }) });
  assert.equal(v.meetWorthy, true);
  assert.ok(v.priority > ff.MARKERS.find((m) => m.key === 'yc').weight, 'the school adds to the YC weight');
});

// ── THE FALSE POSITIVES REAL DATA PRODUCED ──
test('"linkedin" inside a profile URL never counts as working at LinkedIn', () => {
  // 23 real candidates got a bogus Hyperscaler:LinkedIn from the scrape boilerplate.
  const v = ff.evaluate({ raw_data: JSON.stringify({ bio: 'Founder - Remix. https://www.linkedin.com/in/someone Building in stealth.' }) });
  assert.ok(!v.markers.some((m) => m.key === 'hyperscale'), 'a LinkedIn URL must not fire the hyperscaler marker');
});

test('a real LinkedIn employer still counts', () => {
  const v = ff.evaluate({ raw_data: JSON.stringify({ bio: 'Was a senior engineer at LinkedIn for 4 years. Now building in stealth.' }) });
  assert.ok(v.markers.some((m) => m.key === 'hyperscale'), 'employment at LinkedIn is a real hyperscaler marker');
});

// ── HYPERSCALE = EMPLOYMENT, NOT A MENTION ──
// Danny, 2026-07-22: "the hyperscale experience tag is hallucinating ... calibrate
// this to read their real LinkedIn history." A company NAME in the text is not a job.
test('a hyperscaler mentioned as product/customer/backer never fires', () => {
  const noFire = [
    'Building AI tools for Amazon sellers. Founder in stealth.',
    'Our product is aimed at Google ad market.',
    'Backed by ex-Googlers and Stripe alumni. Founder at NewCo.',
    'Building a Google Maps competitor.',
    'Sold my last startup to Meta in 2021.',
    'We integrate with Amazon and Google APIs.',
    'A customer at Google gave us feedback.',
  ];
  for (const bio of noFire) {
    const v = ff.evaluate({ raw_data: JSON.stringify({ bio }) });
    assert.ok(!v.markers.some((m) => m.key === 'hyperscale'), `must NOT fire on: ${bio}`);
  }
});

test('real employment phrasings still fire', () => {
  const fire = [
    'SWE at Google for 4 years, now in stealth.',
    'Previously at Meta on Core Ads.',
    'Ex-Stripe engineer building in stealth.',
    '9 years at Instacart building ML infra.',
    'Machine Learning Engineer at Microsoft.',
    'Spent three years at Amazon AGI Labs.',
  ];
  for (const bio of fire) {
    const v = ff.evaluate({ raw_data: JSON.stringify({ bio }) });
    assert.ok(v.markers.some((m) => m.key === 'hyperscale'), `must fire on: ${bio}`);
  }
});

// ── STRUCTURED HISTORY IS GROUND TRUTH ──
// The LinkedIn scrape's experiences[]/education[] arrays are where someone actually
// worked and studied — un-hallucinatable, because a product blurb never lands there.
test('structured experiences produce an accurate employer, with title', () => {
  const row = {
    linkedin_data: JSON.stringify({
      experiences: [
        { company: 'Stealth', title: 'Founder' },
        { company: 'Google', title: 'Staff Software Engineer' },
      ],
    }),
  };
  const v = ff.evaluate(row);
  const h = v.markers.find((m) => m.key === 'hyperscale');
  assert.ok(h, 'a Google role in experiences[] must fire');
  assert.ok(h.structured, 'it must be marked as structured (ground truth)');
  assert.match(h.evidence, /Google/, 'evidence should name the real role/company');
});

test('a hyperscaler ONLY in a product blurb, absent from experiences[], does not fire', () => {
  const row = {
    linkedin_data: JSON.stringify({ experiences: [{ company: 'Acme AI', title: 'Founder' }] }),
    raw_data: JSON.stringify({ bio: 'Acme AI — the Amazon of B2B procurement.' }),
  };
  const v = ff.evaluate(row);
  assert.ok(!v.markers.some((m) => m.key === 'hyperscale'), '"the Amazon of X" is not employment at Amazon');
});

test('structured education gives an accurate school; a campus mention does not', () => {
  const alum = ff.evaluate({ linkedin_data: JSON.stringify({ education: [{ school: 'Northwestern University' }], experiences: [{ company: 'YC co', title: 'Founder' }] }) });
  assert.ok(alum.markers.some((m) => m.key === 'il_elite_school'), 'a Northwestern education must count');

  const nearby = ff.evaluate({ raw_data: JSON.stringify({ bio: 'Building study tools for University of Chicago students.' }) });
  assert.ok(!nearby.markers.some((m) => m.key === 'il_elite_school'), 'serving a campus is not attending it');
});

// ── THE RECEIPT RULE ──
test('every surfaced marker carries evidence verbatim in the profile', () => {
  const row = { raw_data: JSON.stringify({ bio: 'YC S24. Founder in stealth. Ex-Stripe engineer.' }) };
  const { markers, text } = ff.markersFor(row);
  assert.ok(markers.length > 0);
  for (const m of markers) {
    assert.ok(ff.verbatimIn(m.evidence, text), `marker ${m.key} must have a real receipt, got "${m.evidence}"`);
  }
});

test('an empty profile yields nothing — no marker without a source', () => {
  const v = ff.evaluate({});
  assert.equal(v.markers.length, 0);
  assert.equal(v.meetWorthy, false);
  assert.equal(v.priority, 0);
});

// ── PRIORITY ORDERING ──
test('a stealth founder with two markers outranks a past-earliest founder with three', () => {
  const early = ff.evaluate({ raw_data: JSON.stringify({ bio: 'YC alum, ex-Stripe. Building in stealth.' }) });
  const late = ff.evaluate({ raw_data: JSON.stringify({ bio: 'YC alum, ex-Stripe, second-time founder. Raised our Series B.' }) });
  assert.ok(late.stageTooLate, 'the Series B founder is past earliest');
  assert.ok(early.priority > late.priority, 'earliest-stage must outrank a stronger-but-too-late founder');
});
