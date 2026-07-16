'use strict';
const { test } = require('node:test');
const assert = require('node:assert');
const { resolveCompanyLinkedIn, __test } = require('../lib/resolve-company-linkedin');
const { companySlug, nameMatches } = __test;

// The whole point of this resolver is what it REFUSES. A wrong LinkedIn URL doesn't
// fail loudly — it fills the card with another company's real roster, real hiring
// curve, and real prior employers, all rendered as fact. These tests are the fence.

const exa = (results) => async () => ({ status: 200, data: { results } });

test('companySlug only accepts real company pages', () => {
  assert.strictEqual(companySlug('https://www.linkedin.com/company/permute-ai'), 'permute-ai');
  assert.strictEqual(companySlug('https://linkedin.com/company/Permute-AI/'), 'permute-ai');
  // Everything that is not a company page.
  assert.strictEqual(companySlug('https://www.linkedin.com/in/scott-nelson'), null);
  assert.strictEqual(companySlug('https://www.linkedin.com/school/northwestern'), null);
  assert.strictEqual(companySlug('https://www.linkedin.com/jobs/view/123'), null);
  assert.strictEqual(companySlug('https://www.linkedin.com/posts/someone_activity-123'), null);
  assert.strictEqual(companySlug('https://example.com/company/foo'), null);
  assert.strictEqual(companySlug(null), null);
});

// ── THE CORE TRAP ──
// Danny's book is full of one-word names: Peak, Gil, Jean, Hedge, Prizm, Merlon.
// Substring matching attributes Peak Design's headcount to a 3-person startup.
test('a single-word company name never matches by substring', () => {
  assert.ok(nameMatches('Peak', 'peak'));
  assert.ok(!nameMatches('Peak', 'peakon'), 'Peak must not match Peakon');
  assert.ok(!nameMatches('Peak', 'peak design'), 'Peak must not match Peak Design');
  assert.ok(!nameMatches('Peak', 'peak support'));
  assert.ok(!nameMatches('Jean', 'jean paul gaultier'));
  assert.ok(!nameMatches('Hedge', 'hedgehog labs'));
});

test('corporate suffixes and casing do not break a real match', () => {
  assert.ok(nameMatches('Lumitra, Inc.', 'Lumitra'));
  assert.ok(nameMatches('Lumitra', 'lumitra inc'));
  assert.ok(nameMatches('Diopter AI', 'diopter'));      // "ai" is noise
  assert.ok(nameMatches('Brae Systems', 'Brae Systems | LinkedIn'));
});

test('a multi-word name may match inside a title — two tokens kill the coincidence', () => {
  assert.ok(nameMatches('Lume Security', 'Lume Security | LinkedIn'));
  assert.ok(!nameMatches('Lume Security', 'Lumen Technologies'));
});

test('resolves when exactly one company page matches the name', async () => {
  const r = await resolveCompanyLinkedIn({
    company: 'Brae Systems', founderName: 'Vishnu Indukuri', exaKey: 'k',
    deps: { post: exa([
      { url: 'https://www.linkedin.com/in/vishnu-indukuri', title: 'Vishnu Indukuri' },
      { url: 'https://www.linkedin.com/company/brae-systems', title: 'Brae Systems | LinkedIn', text: 'Vishnu Indukuri' },
    ]) },
  });
  assert.strictEqual(r.url, 'https://www.linkedin.com/company/brae-systems');
});

// ── REFUSALS ──
// Two pages, same one-word name. Refused twice over: the one-word rule drops both
// for lack of corroboration, and even corroborated they'd be ambiguous.
test('two different companies with the same one-word name resolve to NOTHING', async () => {
  const r = await resolveCompanyLinkedIn({
    company: 'Peak', exaKey: 'k',
    deps: { post: exa([
      { url: 'https://www.linkedin.com/company/peak', title: 'Peak | LinkedIn' },
      { url: 'https://www.linkedin.com/company/peak-ai', title: 'Peak | LinkedIn' },
    ]) },
  });
  assert.strictEqual(r.url, null, 'ambiguity must never be resolved by guessing');
});

// Ambiguity must be refused even when the name is multi-word and corroboration
// exists — if two real pages both fit, picking one is a coin flip printed as fact.
test('two pages that both match a multi-word name resolve to NOTHING', async () => {
  const r = await resolveCompanyLinkedIn({
    company: 'Vibe Robotics', exaKey: 'k',
    deps: { post: exa([
      { url: 'https://www.linkedin.com/company/vibe-robotics', title: 'Vibe Robotics | LinkedIn' },
      { url: 'https://www.linkedin.com/company/vibe-robotics-inc', title: 'Vibe Robotics | LinkedIn' },
    ]) },
  });
  assert.strictEqual(r.url, null);
  assert.match(r.reason, /ambiguous/);
});

test('"Stealth" is not a company and is never searched', async () => {
  let called = false;
  const deps = { post: async () => { called = true; return { status: 200, data: { results: [] } }; } };
  for (const name of ['Stealth', 'stealth', 'Stealth Startup']) {
    const r = await resolveCompanyLinkedIn({ company: name, exaKey: 'k', deps });
    assert.strictEqual(r.url, null);
    assert.match(r.reason, /stealth/i);
  }
  assert.strictEqual(called, false, 'searching "Stealth" would enrich every stealth card as the same firm');
});

// ── THE AMPERE CASE ──
// Found on a live run. One candidate, its name matches exactly, and it is the wrong
// company: Danny's Ampere is pre-seed; the page titled "Ampere" is a chip company
// with thousands of staff. Nothing downstream could catch this — the enrichment
// blob would be internally consistent and entirely about someone else.
test('a one-word name matching a single page is REFUSED without corroboration', async () => {
  const r = await resolveCompanyLinkedIn({
    company: 'Ampere', founderName: 'Someone', exaKey: 'k',
    deps: { post: exa([
      { url: 'https://www.linkedin.com/company/amperetech', title: 'Ampere | LinkedIn', text: 'Semiconductors. 3,000 employees.' },
    ]) },
  });
  assert.strictEqual(r.url, null, 'a one-word name may not be resolved on the name alone');
  assert.match(r.reason, /one-word name/);
});

test('a one-word name IS resolved when the page corroborates it', async () => {
  // The founder's name on the page ties it to this company.
  const byFounder = await resolveCompanyLinkedIn({
    company: 'Albacore', founderName: 'Dante Vaisbort', exaKey: 'k',
    deps: { post: exa([
      { url: 'https://www.linkedin.com/company/albacore-inc', title: 'Albacore', text: 'Founded by Dante Vaisbort.' },
    ]) },
  });
  assert.strictEqual(byFounder.url, 'https://www.linkedin.com/company/albacore-inc');

  // Or its own website domain does.
  const bySite = await resolveCompanyLinkedIn({
    company: 'Hedge', website: 'https://hedge.xyz', exaKey: 'k',
    deps: { post: exa([
      { url: 'https://www.linkedin.com/company/hedge', title: 'Hedge', text: 'Website: hedge.xyz' },
    ]) },
  });
  assert.strictEqual(bySite.url, 'https://www.linkedin.com/company/hedge');
});

// A multi-word name is its own witness — collisions are negligible, so it needs no
// second one. Otherwise the fence would refuse almost the whole book.
test('a multi-word name resolves without corroboration', async () => {
  const r = await resolveCompanyLinkedIn({
    company: 'Avant Health', exaKey: 'k',
    deps: { post: exa([{ url: 'https://www.linkedin.com/company/avant-health', title: 'Avant Health | LinkedIn' }]) },
  });
  assert.strictEqual(r.url, 'https://www.linkedin.com/company/avant-health');
});

test('plausible-looking results that do not match the name are refused', async () => {
  const r = await resolveCompanyLinkedIn({
    company: 'Merlon', exaKey: 'k',
    deps: { post: exa([
      { url: 'https://www.linkedin.com/company/merlon-intelligence', title: 'Merlon Intelligence' },
      { url: 'https://www.linkedin.com/company/merlin-labs', title: 'Merlin Labs' },
    ]) },
  });
  assert.strictEqual(r.url, null);
  assert.ok(Array.isArray(r.candidates));
});

test('no results, no key, and no name each refuse cleanly rather than throw', async () => {
  const none = await resolveCompanyLinkedIn({ company: 'Nobody', exaKey: 'k', deps: { post: exa([]) } });
  assert.strictEqual(none.url, null);

  const nokey = await resolveCompanyLinkedIn({ company: 'X' });
  assert.strictEqual(nokey.url, null);
  assert.match(nokey.reason, /Exa key/);

  const noname = await resolveCompanyLinkedIn({ company: '  ', exaKey: 'k' });
  assert.strictEqual(noname.url, null);
});

test('an Exa outage returns a reason, never a guess', async () => {
  const r = await resolveCompanyLinkedIn({
    company: 'Brae Systems', exaKey: 'k',
    deps: { post: async () => { throw new Error('socket hang up'); } },
  });
  assert.strictEqual(r.url, null);
  assert.match(r.reason, /exa error/);
});

test('only person profiles come back → nothing to resolve', async () => {
  const r = await resolveCompanyLinkedIn({
    company: 'Photon Queue', exaKey: 'k',
    deps: { post: exa([
      { url: 'https://www.linkedin.com/in/nathan-arnold', title: 'Nathan Arnold' },
      { url: 'https://www.linkedin.com/in/someone-else', title: 'Someone Else' },
    ]) },
  });
  assert.strictEqual(r.url, null);
  assert.match(r.reason, /no LinkedIn company page/);
});
