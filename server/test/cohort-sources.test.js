'use strict';
const { test } = require('node:test');
const assert = require('node:assert');
const { geoPartition } = require('../lib/geoFilter');
const yc = require('../pipeline/sources/yc-directory');
const rosters = require('../pipeline/sources/cohort-rosters');

// ── geoPartition: IL → pipeline (passed), rest → watchlist (rejected) ──
test('geoPartition splits IL ties from the rest instead of dropping', () => {
  const criteria = { locations: ['chicago', 'illinois', 'evanston'], schools: ['northwestern'] };
  const rows = [
    { name: 'IL co', location_city: 'Chicago', location_state: 'IL', headline: 'YC company' },
    { name: 'SF co', location_city: 'San Francisco', location_state: 'CA', headline: 'YC company' },
    { name: 'NY co', location_city: 'New York', location_state: 'NY', headline: 'YC company' },
  ];
  const { passed, rejected } = geoPartition(rows, criteria);
  assert.equal(passed.length, 1, 'one IL company in the pipeline');
  assert.equal(passed[0].name, 'IL co');
  assert.ok(passed[0].chicago_connection, 'verified tie attached to pipeline rows');
  assert.equal(rejected.length, 2, 'the two non-IL companies are kept for the watchlist');
});

test('geoPartition broad mode (no preference) passes everyone, rejects none', () => {
  const rows = [{ name: 'A', headline: 'x' }, { name: 'B', headline: 'y' }];
  const { passed, rejected } = geoPartition(rows, { locations: [], schools: [] });
  assert.equal(passed.length, 2);
  assert.equal(rejected.length, 0);
});

// ── YC connector ──
test('YC parseLocation reads "City, ST, USA"', () => {
  assert.deepEqual(yc.parseLocation('Chicago, IL, USA'), { city: 'Chicago', state: 'IL' });
  assert.deepEqual(yc.parseLocation('San Francisco, CA, USA; Remote'), { city: 'San Francisco', state: 'CA' });
  assert.deepEqual(yc.parseLocation(''), { city: null, state: null });
});

test('YC normalize maps a company hit → RawRecord (company-level, IL-detectable)', () => {
  const hit = {
    name: 'Acme AI', slug: 'acme-ai', objectID: '123', website: 'https://acme.ai',
    all_locations: 'Chicago, IL, USA', one_liner: 'AI for plumbers', batch: 'Summer 2025',
    industries: ['B2B', 'Engineering'], long_description: 'Long text.',
  };
  const n = yc.normalize(hit);
  assert.equal(n.name, null);              // company-level; founder resolved later
  assert.equal(n.entity_name, 'Acme AI');
  assert.equal(n.company, 'Acme AI');
  assert.equal(n.location_state, 'IL');
  assert.equal(n.location_city, 'Chicago');
  assert.equal(n.website_url, 'https://acme.ai');
  assert.ok(n.url.includes('/companies/acme-ai'));
  assert.match(n.evidence, /YC Summer 2025/);
  assert.match(n.evidence, /Chicago, IL/);
});

test('YC isEarlyStage keeps pre-seed, rejects growth / acquired / stale / oversized', () => {
  // Real shapes observed live:
  assert.ok(yc.isEarlyStage({ name: 'Perspectives Health', stage: 'Early', status: 'Active', batch: 'Summer 2025', team_size: 5 }));
  assert.ok(!yc.isEarlyStage({ name: 'Tovala', stage: 'Growth', status: 'Active', batch: 'Winter 2016', team_size: 375 }), 'growth-stage dropped');
  assert.ok(!yc.isEarlyStage({ name: 'Inkling', stage: 'Early', status: 'Acquired', batch: 'Winter 2006', team_size: 11 }), 'acquired dropped');
  assert.ok(!yc.isEarlyStage({ name: 'CodeNow', stage: 'Early', status: 'Active', batch: 'Winter 2014', team_size: 2 }), 'stale early-tagged co dropped by batch year');
  assert.ok(!yc.isEarlyStage({ name: 'Synapticure', stage: 'Early', status: 'Active', batch: 'Summer 2020', team_size: 115 }), 'oversized team dropped');
  // A brand-new co with no stage/status tags yet still passes on a recent batch.
  assert.ok(yc.isEarlyStage({ name: 'NewCo', batch: 'Summer 2026' }));
});

test('YC buildQueryPlan targets each user location + one recency pull', () => {
  const plan = yc.buildQueryPlan({ locations: ['Chicago', 'Illinois'] }, 50);
  assert.equal(plan.length, 3, 'two location queries + one recency');
  assert.equal(plan.filter(q => q.query === 'Chicago').length, 1);
  assert.equal(plan.filter(q => q.query === '').length, 1, 'recency query has empty query string');
});

test('YC fetch dedupes across queries (mocked Algolia)', async () => {
  const hit = { name: 'Dup Co', slug: 'dup', objectID: '9', all_locations: 'Chicago, IL, USA', batch: 'Winter 2026' };
  const getJson = async () => ({ status: 200, data: { hits: [hit] } });
  const out = await yc.fetch({ criteria: { locations: ['Chicago'] }, limit: 50, deps: { getJson }, opts: { resolveFounders: false } });
  assert.equal(out.length, 1, 'same objectID across location + recency queries collapses to one');
  assert.equal(out[0].company, 'Dup Co');
});

// ── YC founder resolution (the IL-tie-via-school unlock) ──
const FOUNDER_HTML = `
  <div>Active Founders</div>
  <div class="ycdc-card-new">
    <div class="text-xl font-bold">Eshan Dosani</div>
    <a href="https://x.com/EshanDosani">x</a>
    <a href="https://www.linkedin.com/in/eshan-dosani/">li</a>
    <div>CEO/Co-founder</div><div>UChicago, fmr White House Drug Policy</div>
  </div>
  <div class="ycdc-card-new">
    <div class="text-xl font-bold">Kyle Jung</div>
    <a href="https://linkedin.com/in/kyle-hyun-woo-jung-a06814180">li</a>
    <div>CTO/Co-founder</div><div>Northwestern University</div>
  </div>
  <div class="ycdc-card-new">
    <div class="text-xl font-bold">Kyle Jung</div><div>CTO/Co-founder</div><div>Northwestern University</div>
  </div>
  <div class="ycdc-card-new"><div class="text-xl font-bold">Open Roles</div></div>`;

test('YC parseFounders extracts founders w/ bio + linkedin, dedupes, drops non-person cards', () => {
  const fs = yc.parseFounders(FOUNDER_HTML);
  assert.equal(fs.length, 2, 'two founders; desktop/mobile duplicate collapsed; "Open Roles" dropped');
  const eshan = fs.find(f => f.name === 'Eshan Dosani');
  assert.ok(eshan && /UChicago/.test(eshan.bio), 'founder bio carries the school');
  assert.equal(eshan.linkedin_url, 'https://www.linkedin.com/in/eshan-dosani', 'linkedin normalized');
  assert.match(eshan.role, /Co-?founder/i);
});

test('YC founder record ties to IL via school even when the company is elsewhere', () => {
  const sfHit = { name: 'Perspectives Health', slug: 'ph', all_locations: 'San Francisco, CA, USA', batch: 'Summer 2025', one_liner: 'AI for clinics' };
  const [eshan, kyle] = yc.parseFounders(FOUNDER_HTML);
  const recs = [yc.founderRecord(sfHit, eshan), yc.founderRecord(sfHit, kyle)];
  const criteria = { locations: ['chicago', 'illinois'], schools: ['university of chicago', 'uchicago', 'northwestern'] };
  const { passed } = geoPartition(recs, criteria);
  const names = passed.map(p => p.name);
  assert.ok(names.includes('Eshan Dosani'), 'UChicago founder ties to IL despite SF-HQ company');
  assert.ok(names.includes('Kyle Jung'), 'Northwestern founder ties to IL despite SF-HQ company');
});

test('YC fetch resolves founders from company pages (mocked)', async () => {
  const hit = { name: 'Perspectives Health', slug: 'ph', objectID: '1', all_locations: 'Chicago, IL, USA', batch: 'Summer 2025', stage: 'Early', status: 'Active', team_size: 5 };
  const getJson = async () => ({ status: 200, data: { hits: [hit] } });
  const getHtml = async () => ({ status: 200, html: FOUNDER_HTML });
  const out = await yc.fetch({ criteria: { locations: ['Chicago'] }, deps: { getJson, getHtml, db: null }, opts: { resolveMax: 5 } });
  assert.equal(out.length, 2, 'two founder-level records, not one company record');
  assert.ok(out.every(r => r.name && r.entity_name === null), 'records are person-level');
  assert.ok(out.find(r => /UChicago/.test(r.bio)), 'founder bio flows into the record');
});

// ── a16z Speedrun connector (directory-based, founder-level) ──
const speedrun = require('../pipeline/sources/a16z-speedrun');

test('Speedrun normalizeFounder maps a company+founder to a founder record', () => {
  const company = { name: 'Concorda', slug: 'concorda', cohort: 'SR006', city: 'Chicago', state: 'Illinois', description: 'Litigation tech.' };
  const f = { first_name: 'Ke', last_name: 'Ma', slug: 'ke-ma', title: 'CEO', introduction: 'Ex-litigator, UChicago.', linkedin_url: 'https://linkedin.com/in/kema' };
  const r = speedrun.normalizeFounder(company, f);
  assert.equal(r.name, 'Ke Ma');
  assert.equal(r.entity_name, null);
  assert.equal(r.company, 'Concorda');
  assert.equal(r.location_state, 'Illinois');
  assert.match(r.bio, /UChicago/);
  assert.match(r.headline, /Speedrun SR006/);
  assert.equal(r.linkedin_url, 'https://linkedin.com/in/kema');
});

test('Speedrun fetchAll extracts founders, filters cohorts, follows pagination', async () => {
  const page1 = { next: 'PAGE2', results: [
    { name: 'Old', cohort: 'SR001', city: 'NYC', founder_set: [{ first_name: 'Old', last_name: 'Timer', title: 'CEO' }] },
    { name: 'Concorda', cohort: 'SR006', city: 'Chicago', state: 'Illinois', founder_set: [
      { first_name: 'Ke', last_name: 'Ma', title: 'CEO', introduction: 'UChicago' },
      { first_name: 'Sam', last_name: 'Oh', title: 'CTO', introduction: 'UChicago' } ] } ] };
  const page2 = { next: null, results: [{ name: 'NewCo', cohort: 'SR006', city: 'SF', founder_set: [{ first_name: 'Nat', last_name: 'Ional', title: 'Founder' }] }] };
  const getJson = async (url) => ({ status: 200, data: url === 'PAGE2' ? page2 : page1 });
  const recs = await speedrun.fetchAll({ deps: { getJson }, cohorts: ['SR006'] });
  assert.equal(recs.length, 3, 'two Concorda founders + NewCo; SR001 filtered out');
  assert.ok(recs.every(r => r.name && r.entity_name === null));
  assert.ok(recs.find(r => r.name === 'Ke Ma') && !recs.find(r => r.name === 'Old Timer'));
});

// ── Cohort connectors (Exa-backed, founder-level) ──
const { cohortDiscover } = require('../lib/cohortDiscovery');

// A mock Exa "people" search: returns results extractProfile understands (title/url/text).
function mockExa(results) {
  return async (_key, _query, _n) => ({ results });
}
const EXA_RESULTS = [
  { title: 'Jane Fellow - Founder at Acme | LinkedIn', url: 'https://www.linkedin.com/in/jane-fellow',
    text: 'Thiel Fellow. Studied at the University of Chicago. Now building Acme, an AI company.' },
  { title: 'Sam Sf - Cofounder of Bravo | LinkedIn', url: 'https://www.linkedin.com/in/sam-sf',
    text: 'Thiel Fellow based in San Francisco. Previously at Google. Building Bravo.' },
  { title: 'Random Article About Startups', url: 'https://example.com/post',
    text: 'A roundup of companies. No cohort membership stated here.' }, // no marker → excluded
];

test('cohortDiscover keeps only real people whose bio confirms the cohort', async () => {
  const recs = await cohortDiscover({
    exaKey: 'k', queries: ['"Thiel Fellow" founder'], markers: ['thiel fellow'],
    cohortLabel: 'Thiel Fellow', deps: { exaSearch: mockExa(EXA_RESULTS) },
  });
  assert.equal(recs.length, 2, 'two founders confirmed; the non-member article is dropped');
  assert.ok(recs.every(r => r.name && r.entity_name === null), 'records are person-level');
  assert.ok(recs.find(r => /University of Chicago/i.test(r.bio)), 'founder bio flows through for tie-matching');
});

test('cohort connector is dormant without an Exa key, live with one', async () => {
  const thiel = rosters.connectors.find(c => c.key === 'thiel_fellows');
  assert.equal(thiel.nationalWatchlist, true);
  assert.equal(thiel.free, false, 'BYOK: Exa-backed, not free');
  assert.deepEqual(await thiel.fetch({ keys: {} }), [], 'no Exa key → dormant');
  const recs = await thiel.fetch({ keys: { exa: 'k' }, deps: { exaSearch: mockExa(EXA_RESULTS) } });
  assert.equal(recs.length, 2);
});

test('cohort founders geo-route: IL school tie → pipeline, the rest → watchlist', async () => {
  const thiel = rosters.connectors.find(c => c.key === 'thiel_fellows');
  const recs = await thiel.fetch({ keys: { exa: 'k' }, deps: { exaSearch: mockExa(EXA_RESULTS) } });
  const criteria = { locations: ['chicago', 'illinois'], schools: ['university of chicago', 'uchicago', 'northwestern'] };
  const { passed, rejected } = geoPartition(recs, criteria);
  assert.deepEqual(passed.map(p => p.name), ['Jane Fellow'], 'UChicago Thiel Fellow → IL pipeline');
  assert.equal(rejected.length, 1, 'the SF Thiel Fellow → national watchlist');
});
