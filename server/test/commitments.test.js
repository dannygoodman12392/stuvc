'use strict';
// The commitment ledger. Every fixture here is a real line from a real Granola
// transcript in Danny's account — because the whole point is that this data already
// exists and has never been captured.
const { test } = require('node:test');
const assert = require('node:assert');
const { medianSlip, dedupeKey, OWED_BY, STATUS } = require('../lib/commitments');

// ══════════════════════════════════════════════════════════════════════
// Dedupe — the bug that would kill this by Thursday
// ══════════════════════════════════════════════════════════════════════

test('the same promise, seen on seven nightly runs, is ONE row', () => {
  // founder-call-auto-workup calls list_meetings(time_range="this_week") every night.
  // The Cadrian call from Monday gets re-read Tue/Wed/Thu/Fri/Sat/Sun. Without a
  // dedupe key the ledger has 7 copies of the same intro by the weekend and Danny
  // stops opening it.
  const a = dedupeKey(5903, 'Send intro to Tom Elnik and Bezod Surjanny');
  const b = dedupeKey(5903, 'Send intro to Tom Elnik and Bezod Surjanny');
  assert.equal(a, b);
});

test('dedupe survives light rephrasing between runs', () => {
  // The model won't produce byte-identical prose twice. Punctuation and case must not
  // create a second row.
  const a = dedupeKey(5903, 'Send intro to Tom Elnik (Tegus/Alpha Science)');
  const b = dedupeKey(5903, 'send intro to tom elnik  tegus alpha science');
  assert.equal(a, b);
});

test('dedupe does NOT collapse two genuinely different promises', () => {
  const intro = dedupeKey(5903, 'Send intro to Tom Elnik and Bezod Surjanny');
  const demo = dedupeKey(5903, 'Schedule the Cadrian product demo and loop in partners');
  assert.notEqual(intro, demo);
});

test('the same promise from two different founders is two rows', () => {
  assert.notEqual(dedupeKey(5903, 'Send the deck'), dedupeKey(5891, 'Send the deck'));
});

// ══════════════════════════════════════════════════════════════════════
// The delta — the measurement that is the whole point
// ══════════════════════════════════════════════════════════════════════

test('slip is the median days between due and done', () => {
  const kept = [
    { due_at: '2026-07-01', closed_at: '2026-07-03' }, // 2 late
    { due_at: '2026-07-01', closed_at: '2026-07-08' }, // 7 late
    { due_at: '2026-07-01', closed_at: '2026-07-02' }, // 1 late
  ];
  assert.equal(medianSlip(kept), 2);
});

test('slip counts early as negative — a founder who beats their word', () => {
  const kept = [
    { due_at: '2026-07-10', closed_at: '2026-07-08' }, // 2 early
    { due_at: '2026-07-10', closed_at: '2026-07-09' }, // 1 early
  ];
  // True median of [-2,-1] is -1.5. Math.round(-1.5) === -1 in JS (it rounds toward
  // +Infinity, not away from zero) — so an even-length set of early commitments rounds
  // toward "less early". Fine: the sign is what matters here, not the half-day.
  assert.equal(medianSlip(kept), -1);
  assert.ok(medianSlip(kept) < 0, 'early must read as negative');
});

test('slip is null when nobody named a date', () => {
  // Most of Danny's real commitments have no stated deadline — of ~28 found in the
  // last 30 days, only Cadrian ("closing next week") and Scaylor ("this week") did.
  // A founder who never gave a date has not broken anything.
  assert.equal(medianSlip([{ due_at: null, closed_at: '2026-07-03' }]), null);
  assert.equal(medianSlip([]), null);
});

// ══════════════════════════════════════════════════════════════════════
// Shape
// ══════════════════════════════════════════════════════════════════════

test('the vocabulary is small on purpose', () => {
  assert.deepEqual(Object.values(OWED_BY).sort(), ['me', 'them']);
  assert.deepEqual(Object.values(STATUS).sort(), ['broken', 'kept', 'open', 'released']);
});
