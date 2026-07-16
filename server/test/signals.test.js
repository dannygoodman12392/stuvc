const test = require('node:test');
const assert = require('node:assert');
const db = require('../db');
const { recordSource, recordSignals, signalsFor, sourcesFor, deleteSource } = require('../lib/signals');

// ══════════════════════════════════════════════════════════════════════════
// The honesty gate.
//
// Danny: "no hallucinations and 100% honest."
//
// This module's whole value is what it REFUSES, so that is what these tests
// assert. Every case below is a fabrication shape that would otherwise render on
// the card as a confident fact with no way for him to catch it.
// ══════════════════════════════════════════════════════════════════════════

// A real deck's worth of text to check quotes against.
const DECK = `
Cadrian AI — Series Seed
We are building the trust layer for autonomous agents.
Founded 2025 in Chicago by Dan Preiss, previously a partner at a venture fund.
Today we have zero revenue and no paying customers.
We are raising 3 million dollars at a 15 million post-money valuation.
Our pilot with two design partners begins in September.
The team is four engineers and one designer.
`;

let founderId;
test('setup — a founder to hang sources off', () => {
  const r = db.prepare(
    `INSERT INTO founders (name, company, created_by) VALUES ('Test Founder', 'Signal Test Co', 1)`
  ).run();
  founderId = r.lastInsertRowid;
  assert.ok(founderId);
});

test('a source is recorded with its text', () => {
  const s = recordSource({
    founderId, kind: 'deck', title: 'Cadrian seed deck', contentText: DECK, addedBy: 1,
  });
  assert.ok(s.id);
  assert.equal(s.created, true);
});

// The same deck uploaded twice, or the same Granola note pushed by seven nightly
// runs, is ONE source. Duplicates are how a ledger loses its reader.
test('the same content twice is one source, not two', () => {
  const again = recordSource({ founderId, kind: 'deck', title: 'Cadrian seed deck (copy)', contentText: DECK, addedBy: 1 });
  assert.equal(again.created, false);
  assert.equal(sourcesFor(founderId).filter((s) => s.kind === 'deck').length, 1);
});

// ── The gate ──
test('a verbatim quote survives', () => {
  const src = sourcesFor(founderId)[0];
  const r = recordSignals({
    founderId, sourceId: src.id, createdBy: 1,
    candidates: [{ kind: 'traction', claim: 'No revenue and no customers today', quote: 'we have zero revenue and no paying customers' }],
  });
  assert.equal(r.kept, 1);
  assert.equal(r.signals[0].verification, 'verbatim');
});

// THE CASE THAT MATTERS. A fabricated quote must not reach the card.
test('a quote that is NOT in the source is DROPPED, not badged', () => {
  const src = sourcesFor(founderId)[0];
  const r = recordSignals({
    founderId, sourceId: src.id, createdBy: 1,
    candidates: [{
      kind: 'traction',
      claim: 'Closed four enterprise customers in six weeks',
      quote: 'we closed four enterprise customers in six weeks', // nowhere in DECK
    }],
  });
  assert.equal(r.kept, 0);
  assert.equal(r.dropped, 1);
  assert.match(r.reasons[0], /quote not found/);
});

// The highest-damage hallucination available: a number that reads as a fact.
// A verbatim quote elsewhere in the row does nothing to catch it.
test('a claim asserting a number the source never states is DROPPED', () => {
  const src = sourcesFor(founderId)[0];
  const r = recordSignals({
    founderId, sourceId: src.id, createdBy: 1,
    candidates: [{
      kind: 'traction',
      claim: 'Reached $60K ARR with 12 customers', // neither number is in DECK
      quote: 'Today we have zero revenue and no paying customers', // a REAL quote
    }],
  });
  assert.equal(r.kept, 0, 'a real quote must not launder an invented number');
  assert.match(r.reasons[0], /invented/);
});

// A number that IS in the source passes.
test('a claim using a number the source states is kept', () => {
  const src = sourcesFor(founderId)[0];
  const r = recordSignals({
    founderId, sourceId: src.id, createdBy: 1,
    candidates: [{ kind: 'raise', claim: 'Raising 3 million at a 15 million post', quote: 'raising 3 million dollars at a 15 million post-money valuation' }],
  });
  assert.equal(r.kept, 1);
});

// The verify.js scar, re-asserted at this layer: "closed four" is not "lost four".
test('a near-miss reshuffle does not sneak through as a paraphrase', () => {
  const src = sourcesFor(founderId)[0];
  const r = recordSignals({
    founderId, sourceId: src.id, createdBy: 1,
    candidates: [{ kind: 'traction', claim: 'They have paying customers', quote: 'we have several paying customers today' }],
  });
  assert.equal(r.kept, 0, '"several paying customers" inverts "no paying customers"');
});

test('a signal with no quote at all is dropped', () => {
  const src = sourcesFor(founderId)[0];
  const r = recordSignals({
    founderId, sourceId: src.id, createdBy: 1,
    candidates: [{ kind: 'team', claim: 'Strong technical team' }],
  });
  assert.equal(r.kept, 0);
  assert.match(r.reasons[0], /no quote/);
});

// A source we couldn't read must produce NOTHING, rather than let a model
// narrate from the filename. A scanned deck is not a deck.
test('a source with no readable text produces no signals', () => {
  const s = recordSource({ founderId, kind: 'deck', title: 'scanned.pdf', contentText: '', uri: 'scanned.pdf', addedBy: 1 });
  const r = recordSignals({
    founderId, sourceId: s.id, createdBy: 1,
    candidates: [{ kind: 'product', claim: 'Great product', quote: 'great product' }],
  });
  assert.equal(r.kept, 0);
  assert.match(r.reasons[0], /no readable text/);
});

// The drop count must be visible. A gate you can't see is indistinguishable from
// an extractor that found nothing — and Danny would rightly call it broken.
test('drops are reported, never silent', () => {
  const src = sourcesFor(founderId).find((s) => s.kind === 'deck' && s.chars > 40);
  const r = recordSignals({
    founderId, sourceId: src.id, createdBy: 1,
    candidates: [
      { kind: 'raise', claim: 'Raising 3 million dollars', quote: 'raising 3 million dollars' },
      { kind: 'traction', claim: 'Has 40 customers', quote: 'we have 40 happy customers' },
    ],
  });
  assert.equal(r.kept, 1);
  assert.equal(r.dropped, 1);
  assert.ok(r.reasons.length > 0, 'the reason must be stated');
});

// The storage layer must refuse too, so no future code path can bypass the gate.
test('the DB itself rejects an unverified signal', () => {
  const src = sourcesFor(founderId)[0];
  assert.throws(
    () => db.prepare(
      `INSERT INTO company_signals (founder_id, source_id, kind, claim, quote, verification)
       VALUES (?, ?, 'traction', 'sneaky', 'sneaky quote', 'unverified')`
    ).run(founderId, src.id),
    /CHECK constraint failed/,
    'a CHECK constraint must make unverified unrepresentable'
  );
});

// A claim must never outlive its evidence.
test('deleting a source deletes the signals it produced', () => {
  const before = signalsFor(founderId).length;
  const src = sourcesFor(founderId).find((s) => s.signal_count > 0);
  assert.ok(src, 'need a source with signals');
  deleteSource(founderId, src.id);
  const after = signalsFor(founderId).length;
  assert.ok(after < before, 'orphaned claims are exactly what this prevents');
  assert.equal(signalsFor(founderId).filter((s) => s.source_id === src.id).length, 0);
});

// Every surviving signal carries its receipt.
test('every signal renders with its source and its line', () => {
  for (const s of signalsFor(founderId)) {
    assert.ok(s.source_id, 'no orphan claims');
    assert.ok(s.quote && s.quote.length > 0, 'no claim without its line');
    assert.ok(s.source_kind, 'the reader must be able to see WHERE it came from');
    assert.ok(['verbatim', 'paraphrased'].includes(s.verification));
  }
});

test('teardown', () => {
  for (const s of sourcesFor(founderId)) deleteSource(founderId, s.id);
  db.prepare('DELETE FROM founders WHERE id = ?').run(founderId);
});
