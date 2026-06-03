'use strict';
const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const Database = require('better-sqlite3');

// The original bug: approve did INSERT(founders) then UPDATE(sourced_founders) as TWO
// separate statements. A failure between them left an orphan/duplicate. This proves the
// transactional pattern we now use rolls the whole thing back on any failure.
test('a transaction rolls back the INSERT if a later step throws (no orphan)', () => {
  const db = new Database(':memory:');
  db.exec('CREATE TABLE founders(id INTEGER PRIMARY KEY, name TEXT); CREATE TABLE sourced(id INTEGER PRIMARY KEY, status TEXT);');
  db.prepare("INSERT INTO sourced(id, status) VALUES (1, 'pending')").run();

  const tx = db.transaction(() => {
    db.prepare("INSERT INTO founders(name) VALUES ('X')").run();   // step 1
    throw new Error('simulated crash before status update');        // step 2 fails
  });
  assert.throws(() => tx(), /simulated crash/);

  // Atomicity: the founder INSERT must have been rolled back — no orphan founder.
  assert.strictEqual(db.prepare('SELECT COUNT(*) c FROM founders').get().c, 0);
  // And the sourced row is untouched (still pending, can be retried cleanly).
  assert.strictEqual(db.prepare("SELECT status FROM sourced WHERE id=1").get().status, 'pending');
});

// Static guard: the real approve route must wrap its work in a transaction and re-check
// status inside it (idempotency against double-click / re-run).
test('approve route is transactional and re-checks status', () => {
  const src = fs.readFileSync(path.join(__dirname, '..', 'routes', 'sourcing.js'), 'utf8');
  const approve = src.slice(src.indexOf("approve/:id"));
  assert.ok(/db\.transaction\(/.test(approve), 'approve must use db.transaction()');
  assert.ok(/status IN \('pending','starred'\)[\s\S]{0,400}transaction|transaction[\s\S]{0,600}status IN \('pending','starred'\)/.test(approve), 'approve must re-check status inside the transaction');
});
