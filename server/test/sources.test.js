'use strict';
const { test } = require('node:test');
const assert = require('node:assert');
const { geoFilter } = require('../lib/geoFilter');
const uspto = require('../pipeline/sources/uspto-trademark');

test('geoFilter broad mode (no criteria) passes everyone', () => {
  const rows = [{ name: 'A', headline: 'Founder in Berlin' }, { name: 'B', headline: 'Founder in SF' }];
  const out = geoFilter(rows, { locations: [], schools: [] });
  assert.equal(out.length, 2);
});

test('geoFilter with IL criteria keeps IL ties, drops others', () => {
  const criteria = { locations: ['chicago', 'illinois', 'evanston'], schools: ['northwestern', 'university of chicago'] };
  const rows = [
    { name: 'IL guy', location_city: 'Chicago', location_state: 'IL', headline: 'Founder' },
    { name: 'SF guy', headline: 'Founder based in San Francisco' },
    { name: 'NU alum', headline: 'Founder', bio: 'Studied at Northwestern University' },
  ];
  const out = geoFilter(rows, criteria);
  const names = out.map(o => o.name);
  assert.ok(names.includes('IL guy'), 'structured Chicago/IL address passes');
  assert.ok(names.includes('NU alum'), 'IL school passes');
  assert.ok(!names.includes('SF guy'), 'SF founder is dropped');
  assert.ok(out.find(o => o.name === 'IL guy').chicago_connection, 'verified tie is attached');
});

test('USPTO normalize maps an individual owner + state + evidence + url', () => {
  const rec = { serialNumber: '99123456', filingDate: '2026-06-01', markText: 'ACME AI', owners: [{ name: 'Jane Founder', ownerType: '1', address: { city: 'Chicago', state: 'IL' } }] };
  const n = uspto.normalize(rec);
  assert.equal(n.name, 'Jane Founder');      // individual owner → named person
  assert.equal(n.location_state, 'IL');
  assert.match(n.evidence, /ACME AI/);
  assert.ok(n.url && n.url.includes('99123456'));
  assert.equal(n.emits === undefined, true); // normalize returns a RawRecord, not the connector
});

test('USPTO normalize handles a company owner (no person name)', () => {
  const rec = { serialNumber: '1', markText: 'FOO', owners: [{ name: 'Foo Labs Inc', ownerType: '3', address: { state: 'CA' } }] };
  const n = uspto.normalize(rec);
  assert.equal(n.name, null);
  assert.equal(n.entity_name, 'Foo Labs Inc');
  assert.equal(n.location_state, 'CA');
});

test('USPTO fetch is dormant without an API key', async () => {
  const prev = process.env.USPTO_API_KEY;
  delete process.env.USPTO_API_KEY;
  const out = await uspto.fetch({ criteria: { locations: ['chicago'] } });
  assert.deepEqual(out, []);
  if (prev !== undefined) process.env.USPTO_API_KEY = prev;
});
