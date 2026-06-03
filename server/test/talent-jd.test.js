'use strict';
const { test } = require('node:test');
const assert = require('node:assert');
const T = require('../pipeline/talent-engine');

// A CMO / GTM role must route to the gtm pool and pull GTM leaders — never engineers.
test('non-engineering role uses its archetype query pool', () => {
  const roleScope = { id: 1, title: 'CMO', function: 'gtm', band: 'A', must_haves: [], domains: [], stacks: [] };
  const criteria = { locations: ['chicago'], bands: ['A', 'B', 'C'] };
  const queries = T.buildTalentQueries(criteria, false, roleScope);
  const blob = queries.map(q => q.query).join(' ').toLowerCase();
  assert.ok(/cmo|marketing|sales|growth|gtm/.test(blob), 'should target GTM titles');
  assert.ok(!/founding engineer|staff engineer|computer science|phd/.test(blob), 'should NOT target engineers');
});

test('non-engineering search defaults to Chicago when no location set', () => {
  const roleScope = { id: 1, title: 'Head of Growth', function: 'gtm', band: 'A', must_haves: [], domains: [], stacks: [] };
  const queries = T.buildTalentQueries({ bands: ['A'] }, false, roleScope);
  assert.ok(queries.length > 0);
  assert.ok(queries.every(q => /chicago/i.test(q.query)), 'every query should bias to Chicago');
});

// deriveJdQueries turns a JD into targeted searches and normalizes them safely.
test('deriveJdQueries enforces site: prefix, band, and cap', async () => {
  const fakeAnthropic = {
    messages: {
      create: async () => ({
        content: [{ text: JSON.stringify({ queries: [
          { band: 'A', name: 'Healthcare CMO', query: '("CMO" OR "VP Marketing") healthcare chicago' }, // missing site:
          { band: 'X', name: 'bad band', query: 'site:linkedin.com/in growth marketer chicago' },       // bad band → B
          ...Array.from({ length: 8 }, (_, i) => ({ band: 'B', name: `q${i}`, query: `site:linkedin.com/in role${i}` })),
        ] }) }],
      }),
    },
  };
  const roleScope = { title: 'CMO', jd_content: 'Lead marketing for a healthcare startup', must_haves: ['demand gen'], domains: ['healthcare'] };
  const out = await T.deriveJdQueries(fakeAnthropic, roleScope, 'gtm', ' chicago');
  assert.ok(out.length <= 6, 'capped at 6');
  assert.ok(out.every(q => /^site:linkedin\.com\/in/.test(q.query)), 'site: prefix enforced');
  assert.ok(out.every(q => /^[ABC]$/.test(q.band)), 'bands normalized');
  assert.ok(out.every(q => q.name.startsWith('JD:')), 'labeled as JD-derived');
});

test('deriveJdQueries returns [] without an anthropic client (graceful floor)', async () => {
  const out = await T.deriveJdQueries(null, { title: 'CMO' }, 'gtm', ' chicago');
  assert.deepStrictEqual(out, []);
});

test('deriveJdQueries swallows LLM errors and returns []', async () => {
  const boom = { messages: { create: async () => { throw new Error('rate limit'); } } };
  const out = await T.deriveJdQueries(boom, { title: 'CMO', jd_content: 'x' }, 'gtm', ' chicago');
  assert.deepStrictEqual(out, []);
});
