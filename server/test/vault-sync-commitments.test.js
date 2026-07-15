'use strict';
// The Listener's write path.
//
// This is the ONE hole in Stu's wall, so it gets tested like one. The vault-sync
// channel is owner-only and secret-gated because Stu's shareable MCP surface has an
// explicit boundary against founders/assessments/notes — this must not become a way
// around it.
const { test, before, after } = require('node:test');
const assert = require('node:assert');
const express = require('express');
const db = require('../db');

const SECRET = 'test-vault-secret-do-not-use';
let server, base;

before(async () => {
  process.env.VAULT_SYNC_SECRET = SECRET;
  delete require.cache[require.resolve('../routes/vaultSync')];
  const app = express();
  app.use(express.json());
  app.use('/api/vault-sync', require('../routes/vaultSync'));
  await new Promise((r) => { server = app.listen(0, r); });
  base = `http://127.0.0.1:${server.address().port}/api/vault-sync`;
});

after(() => {
  db.prepare("DELETE FROM commitments WHERE commitment LIKE 'VSTEST::%'").run();
  server.close();
});

const post = (body, secret = SECRET) =>
  fetch(base + '/commitments', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-vault-sync-secret': secret },
    body: JSON.stringify(body),
  });

const realFounder = () => db.prepare("SELECT id, name FROM founders WHERE is_deleted=0 AND name IS NOT NULL LIMIT 1").get();

test('no secret, no write', async () => {
  const r = await post({ commitments: [] }, 'wrong-secret');
  assert.equal(r.status, 401);
});

test('it writes a commitment and resolves the founder by name', async () => {
  // The nightly task knows "Dan Preiss" off the Granola title, not a database id.
  const f = realFounder();
  const r = await post({
    commitments: [{
      founder_name: f.name,
      owed_by: 'me',
      commitment: 'VSTEST::send the intro',
      quote: "I owe you some intros. So I'm going to send some notes out.",
      stated_at: '2026-07-14',
      due_at: '2026-07-18',
      source_ref: 'granola:test',
    }],
  });
  assert.equal(r.status, 200);
  const out = await r.json();
  assert.equal(out.created, 1);
  const row = db.prepare("SELECT * FROM commitments WHERE commitment = 'VSTEST::send the intro'").get();
  assert.equal(row.founder_id, f.id);
  assert.equal(row.owed_by, 'me');
  assert.ok(row.quote, 'the verbatim line is stored');
});

test('the nightly re-run adds nothing — it re-reads the same week every night', async () => {
  const f = realFounder();
  const body = { commitments: [{
    founder_name: f.name, owed_by: 'me', commitment: 'VSTEST::send the intro',
    quote: "I owe you some intros. So I'm going to send some notes out.",
    stated_at: '2026-07-14',
  }] };
  const out = await (await post(body)).json();
  assert.equal(out.created, 0);
  assert.equal(out.deduped, 1, 'seen before → deduped, not duplicated');
});

test('a commitment with no verbatim quote is REFUSED, not silently stored', async () => {
  // A commitment without the line that proves it is a paraphrase — and a paraphrase
  // of a promise is exactly the thing a founder can perform.
  const f = realFounder();
  const out = await (await post({
    commitments: [{ founder_name: f.name, owed_by: 'them', commitment: 'VSTEST::no quote', stated_at: '2026-07-14' }],
  })).json();
  assert.equal(out.created, 0);
  assert.equal(out.skipped.length, 1);
  assert.match(out.skipped[0].reason, /verbatim/i);
});

test('an unknown founder is skipped and REPORTED, never guessed at', async () => {
  const out = await (await post({
    commitments: [{ founder_name: 'Nobody McNotreal', owed_by: 'me', commitment: 'VSTEST::x', quote: 'y', stated_at: '2026-07-14' }],
  })).json();
  assert.equal(out.created, 0);
  assert.match(out.skipped[0].reason, /no matching founder/);
});

test('it is a commitments endpoint, not a general write API', async () => {
  const r = await post({ founders: [{ name: 'hax' }] });
  assert.equal(r.status, 400);
});

test('bulk is bounded', async () => {
  const r = await post({ commitments: new Array(201).fill({}) });
  assert.equal(r.status, 400);
});
