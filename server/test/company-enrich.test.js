const test = require('node:test');
const assert = require('node:assert');
const { fetchHeadcountSeries, fetchHeadcountAt, fetchCompanyProfile, enrichCompany } = require('../pipeline/company-enrich');

// ══════════════════════════════════════════════════════════════════════════
// Company enrichment. The HTTP call is injected, so every path/param below is
// asserted against EnrichLayer's documented contract without touching network.
//
// This matters more than usual here. Two connectors in this repo call endpoints
// that don't do what their code claims — USPTO hits a path that has never
// existed, and Form D passed `locationCode` (singular), which EDGAR silently
// ignores while cheerfully returning identical nationwide results for every
// state. Both shipped because nobody asserted the request. So: assert the
// request, not just the response.
// ══════════════════════════════════════════════════════════════════════════

const KEY = 'test-key';
const URL_ = 'https://linkedin.com/company/acme';

function stub(handler) {
  const calls = [];
  return {
    calls,
    getJson: async (url, headers) => { calls.push({ url, headers }); return handler(url, headers); },
  };
}

test('company profile hits the documented path with Bearer auth', async () => {
  const s = stub(() => ({ status: 200, data: { name: 'Acme', industry: 'Software Development' } }));
  await fetchCompanyProfile(URL_, KEY, { deps: { getJson: s.getJson } });

  const { url, headers } = s.calls[0];
  assert.ok(url.startsWith('https://enrichlayer.com/api/v2/company?'), `wrong path: ${url}`);
  assert.match(url, /url=https%3A%2F%2Flinkedin\.com%2Fcompany%2Facme/);
  assert.match(url, /funding_data=include/);
  assert.equal(headers.Authorization, `Bearer ${KEY}`);
});

test('headcount hits the employees/count path and passes at_date', async () => {
  const s = stub(() => ({ status: 200, data: { verified_employee_count: 12 } }));
  await fetchHeadcountAt(URL_, KEY, '2026-01-15', { deps: { getJson: s.getJson } });

  const { url } = s.calls[0];
  assert.ok(url.startsWith('https://enrichlayer.com/api/v2/company/employees/count?'), `wrong path: ${url}`);
  assert.match(url, /at_date=2026-01-15/);
});

test('no at_date means today — the param is omitted, not sent empty', async () => {
  const s = stub(() => ({ status: 200, data: { verified_employee_count: 12 } }));
  await fetchHeadcountAt(URL_, KEY, null, { deps: { getJson: s.getJson } });
  assert.ok(!s.calls[0].url.includes('at_date'), 'at_date must be absent, not blank');
});

// A verified 12 and an estimated 12 are not the same claim.
test('verified count wins over estimated, and says which it used', async () => {
  const s = stub(() => ({ status: 200, data: { verified_employee_count: 12, estimated_employee_count: 40 } }));
  const r = await fetchHeadcountAt(URL_, KEY, null, { deps: { getJson: s.getJson } });
  assert.equal(r.count, 12);
  assert.equal(r.verified, true);

  const s2 = stub(() => ({ status: 200, data: { estimated_employee_count: 40 } }));
  const r2 = await fetchHeadcountAt(URL_, KEY, null, { deps: { getJson: s2.getJson } });
  assert.equal(r2.count, 40);
  assert.equal(r2.verified, false);
});

// ── The growth curve ──
test('a growth series computes a real slope', async () => {
  // 12mo ago: 20 people. now: 50. -> +30, +150%, growing.
  const counts = [50, 40, 30, 20]; // now, -3, -6, -12
  let i = 0;
  const s = stub(() => ({ status: 200, data: { verified_employee_count: counts[i++] } }));

  const r = await fetchHeadcountSeries(URL_, KEY, { deps: { getJson: s.getJson } });
  assert.equal(r.now, 50);
  assert.equal(r.delta_12mo, 30);
  assert.equal(r.growth_12mo_pct, 150);
  assert.equal(r.hiring, 'growing');
  assert.equal(r.series.length, 4);
  // Oldest first — a curve reads left to right.
  assert.equal(r.series[0].months_ago, 12);
});

// ── The percentage is suppressed at pre-seed scale ──
// From the first live run: Permute AI went 1 -> 2 -> 3 -> 3 over 12 months, and
// the honest arithmetic is "+200% growth". True, and useless — they hired two
// people. Danny's entire book is 2-10 person companies, so a ratio off a base
// this small is always noise, and a number that reads precise while meaning
// nothing invites a comparison between a 1->3 and a 40->120 that the arithmetic
// supports and reality does not.
test('a tiny base suppresses the percentage and leads with the delta', async () => {
  const counts = [3, 3, 2, 1]; // the real Permute curve
  let i = 0;
  const s = stub(() => ({ status: 200, data: { verified_employee_count: counts[i++] } }));

  const r = await fetchHeadcountSeries(URL_, KEY, { deps: { getJson: s.getJson } });
  assert.equal(r.now, 3);
  assert.equal(r.delta_12mo, 2, 'the delta is the whole truth: they hired 2 people');
  assert.equal(r.growth_12mo_pct, null, '+200% off a base of 1 is not a growth rate');
  assert.match(r.pct_suppressed, /too small/);
  assert.equal(r.hiring, 'growing', 'direction is still knowable');
});

test('at real scale the percentage survives', async () => {
  const counts = [120, 90, 60, 40]; // base of 40 — a ratio means something here
  let i = 0;
  const s = stub(() => ({ status: 200, data: { verified_employee_count: counts[i++] } }));
  const r = await fetchHeadcountSeries(URL_, KEY, { deps: { getJson: s.getJson } });
  assert.equal(r.growth_12mo_pct, 200);
  assert.equal(r.pct_suppressed, null);
});

test('shrinking is reported as shrinking, not as a negative growth number to squint at', async () => {
  const counts = [4, 6, 8, 10]; // now=4 … 12mo ago=10
  let i = 0;
  const s = stub(() => ({ status: 200, data: { verified_employee_count: counts[i++] } }));
  const r = await fetchHeadcountSeries(URL_, KEY, { deps: { getJson: s.getJson } });
  assert.equal(r.hiring, 'shrinking');
  assert.equal(r.delta_12mo, -6);
});

// The conviction engine's rule, one layer up: an unmeasured company is not a flat
// company. n=1 must not render as 0% growth.
test('a single data point yields NULL growth, never 0', async () => {
  let i = 0;
  const s = stub(() => (i++ === 0 ? { status: 200, data: { verified_employee_count: 10 } } : { status: 404, data: null }));
  const r = await fetchHeadcountSeries(URL_, KEY, { deps: { getJson: s.getJson } });
  assert.equal(r.now, 10);
  assert.equal(r.growth_12mo_pct, null, 'one point is not a trend');
  assert.equal(r.delta_12mo, null);
  assert.equal(r.hiring, null, 'null means unknown — not flat');
});

test('a company that returns nothing enriches to null, it does not invent zeros', async () => {
  const s = stub(() => ({ status: 404, data: null }));
  assert.equal(await fetchHeadcountSeries(URL_, KEY, { deps: { getJson: s.getJson } }), null);
  assert.equal(await enrichCompany(URL_, { deps: { key: KEY, getJson: s.getJson } }), null);
});

test('dormant without a key — never throws, never calls out', async () => {
  const s = stub(() => ({ status: 200, data: {} }));
  assert.equal(await enrichCompany(URL_, { deps: { key: null, getJson: s.getJson } }), null);
  assert.equal(s.calls.length, 0, 'must not call the API without a key');
});

test('no linkedin url means no call', async () => {
  const s = stub(() => ({ status: 200, data: {} }));
  assert.equal(await enrichCompany(null, { deps: { key: KEY, getJson: s.getJson } }), null);
  assert.equal(s.calls.length, 0);
});

// company_size is a [min,max] bucket; company_size_on_linkedin is the real count.
// They disagree constantly, so both are kept rather than reconciled.
test('both size fields survive — the range and the integer', async () => {
  const s = stub((url) =>
    url.includes('employees/count')
      ? { status: 200, data: { verified_employee_count: 7 } }
      : { status: 200, data: { name: 'Acme', company_size: [2, 10], company_size_on_linkedin: 7, founded_year: 2024 } }
  );
  const r = await enrichCompany(URL_, { deps: { key: KEY, getJson: s.getJson } });
  assert.deepEqual(r.size_range, [2, 10]);
  assert.equal(r.size_on_linkedin, 7);
  assert.equal(r.founded_year, 2024);
});
