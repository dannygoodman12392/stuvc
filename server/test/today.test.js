'use strict';
// Today — driven through the REAL express router against the REAL schema.
// Inspection wouldn't catch either of the two bugs pinned here: the agent-row
// resurrection, and a pass sneaking through without a prediction.
const { test, before, after } = require('node:test');
const assert = require('node:assert');
const express = require('express');
const db = require('../db');

const UID = 1;
let app, server, base;

before(async () => {
  app = express();
  app.use(express.json());
  app.use((req, _res, next) => { req.user = { id: UID }; next(); }); // stub auth
  app.use('/api/today', require('../routes/today'));
  await new Promise((r) => { server = app.listen(0, r); });
  base = `http://127.0.0.1:${server.address().port}/api/today`;
});

after(() => {
  db.prepare("DELETE FROM today_items WHERE title LIKE 'TEST::%'").run();
  db.prepare("DELETE FROM decisions WHERE prediction LIKE 'TEST::%'").run();
  db.prepare("DELETE FROM commitments WHERE commitment LIKE 'TEST::%'").run();
  server.close();
});

const post = (p, b) => fetch(base + p, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(b) });
const patch = (p, b) => fetch(base + p, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(b) });
const del = (p) => fetch(base + p, { method: 'DELETE' });

// ══════════════════════════════════════════════════════════════════
// THE BUG THIS PATTERN ALWAYS SHIPS
// ══════════════════════════════════════════════════════════════════

test('an agent row Danny dismissed is NEVER resurrected by the next run', async () => {
  // The nightly workup task re-reads "this week" every night. If dismissing an agent
  // row just deletes it, tomorrow's run re-inserts it — and by Thursday Danny has
  // learned the list doesn't listen to him and stops opening it. This is the single
  // most common way a mixed agent/user queue dies.
  const key = 'TEST::agent-row-1';
  db.prepare(`INSERT INTO today_items (origin, lane, title, dedupe_key, created_by) VALUES ('agent','i_owe','TEST::send the intro',?,?)`).run(key, UID);
  const row = db.prepare('SELECT * FROM today_items WHERE dedupe_key = ?').get(key);

  const r = await del(`/items/${row.id}`);
  assert.equal((await r.json()).dismissed, true, 'agent rows tombstone, they do not delete');

  const after = db.prepare('SELECT * FROM today_items WHERE dedupe_key = ?').get(key);
  assert.ok(after, 'the row still exists...');
  assert.ok(after.dismissed_at, '...tombstoned');

  // The re-run: an upsert on the same key must not clear the tombstone.
  db.prepare(`INSERT INTO today_items (origin, lane, title, dedupe_key, created_by)
              VALUES ('agent','i_owe','TEST::send the intro',?,?)
              ON CONFLICT(dedupe_key) DO UPDATE SET title = excluded.title`).run(key, UID);
  const rerun = db.prepare('SELECT * FROM today_items WHERE dedupe_key = ?').get(key);
  assert.ok(rerun.dismissed_at, 'STILL tombstoned after the agent re-ran');

  const list = await (await fetch(base)).json();
  assert.ok(!list.items.some((i) => i.dedupe_key === key), 'and it never comes back to the screen');
});

test("Danny's own rows are his — they delete outright", async () => {
  const r = await post('/items', { title: 'TEST::call Brandon' });
  const item = await r.json();
  assert.equal(item.origin, 'user');
  await del(`/items/${item.id}`);
  assert.equal(db.prepare('SELECT * FROM today_items WHERE id = ?').get(item.id), undefined, 'gone, not tombstoned');
});

test('he can add, edit, complete, and uncomplete his own rows', async () => {
  const item = await (await post('/items', { title: 'TEST::draft the Cadrian follow-up' })).json();

  await patch(`/items/${item.id}`, { title: 'TEST::draft the Cadrian follow-up (v2)' });
  assert.match(db.prepare('SELECT title FROM today_items WHERE id=?').get(item.id).title, /v2/);

  await patch(`/items/${item.id}`, { completed: true });
  assert.ok(db.prepare('SELECT completed_at FROM today_items WHERE id=?').get(item.id).completed_at);

  await patch(`/items/${item.id}`, { completed: false });
  assert.equal(db.prepare('SELECT completed_at FROM today_items WHERE id=?').get(item.id).completed_at, null, 'un-checking works');
});

// ══════════════════════════════════════════════════════════════════
// The metric. This is the design.
// ══════════════════════════════════════════════════════════════════

test('a pass WITHOUT a prediction is refused — it is a reflex, not a decision', async () => {
  // Danny's most common kill is "technically cool but relatively easy and indefensible" —
  // available in ten seconds on any deal. And Portfolio Pattern Analysis: his
  // undocumented passes on STRONG founders (Crebit, StrideKick, Concorda) are his most
  // fixable blind spot — "you can't tell whether those were good passes or fear/laziness."
  // If pass=+1 with no prediction, the metric pays him to fire the reflex faster.
  const r = await post('/decisions', { band: 'pass', rationale: 'indefensible' });
  assert.equal(r.status, 400);
  const body = await r.json();
  assert.match(body.error, /falsifiable prediction/i);
  assert.match(body.detail, /good pass or a fast one/i);
});

test('a decision without a resolve_by date is refused', async () => {
  const r = await post('/decisions', { band: 'pass', prediction: 'TEST::they will not raise' });
  assert.equal(r.status, 400);
  assert.match((await r.json()).error, /resolve_by/);
});

test('a bad band is refused', async () => {
  const r = await post('/decisions', { band: 'Invest', prediction: 'TEST::x', resolve_by: '2026-12-01' });
  assert.equal(r.status, 400, 'the retired Invest/Monitor/Pass vocabulary is not accepted');
});

test('a decision WITH a dated prediction lands, and captures the gap', async () => {
  const r = await post('/decisions', {
    band: 'memo',
    rationale: 'TEST::Dan built the thesis in 2022 before leaving Ardent. The charisma flag is reading a VC who can present.',
    prediction: 'TEST::Cadrian closes the $1M extension by 2026-08-01 at the $15M cap',
    resolve_by: '2026-08-01',
  });
  assert.equal(r.status, 200);
  const d = await r.json();
  assert.equal(d.band, 'memo');
  assert.ok(d.prediction);
  assert.ok(d.resolve_by);
});

test('the headline number is DECIDED — pipeline count is not exposed at all', async () => {
  const body = await (await fetch(base)).json();
  assert.ok('decided_this_week' in body, 'decided is the headline');
  assert.ok(!('pipeline_count' in body), 'Danny: "I want to inflate my pipeline numbers" — so it is not a number here');
  assert.ok(!('total_pipeline' in body));
});

test('Today returns the lanes in decay order, undecided first', async () => {
  const body = await (await fetch(base)).json();
  for (const k of ['undecided', 'i_owe', 'they_owe', 'predictions_due', 'items']) {
    assert.ok(k in body, `missing lane: ${k}`);
  }
  assert.ok(Array.isArray(body.undecided));
});

// ══════════════════════════════════════════════════════════════════
// Calibration — the only thing here that compounds
// ══════════════════════════════════════════════════════════════════

test('calibration reports null, not 50%, when nothing has resolved', async () => {
  // n=0 is not a coin flip. Same rule the conviction engine enforces: never report a
  // number the evidence doesn't support.
  const c = await (await fetch(base + '/decisions/calibration')).json();
  assert.equal(c.danny_right_when_disagreed, null);
  assert.ok('disagreed' in c && 'awaiting' in c);
});
