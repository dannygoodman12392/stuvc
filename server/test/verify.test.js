'use strict';
const { test } = require('node:test');
const assert = require('node:assert');
const {
  classifyQuote,
  buildContextIndex,
  unsupportedNumbers,
  verifyAllAgents,
} = require('../agents/verify');

// A realistic-length transcript. The old bag-of-words check got easier to fool the
// longer this got, because every content word eventually appears SOMEWHERE.
const TRANSCRIPT = `
--- CALL TRANSCRIPT 1: Founder Meeting ---
So the way we got here is I ran claims operations at a TPA for six years. We closed four customers
in the first six weeks after launch, all mid-market payers. I lost my first two deals before I
figured out the pitch. The thing smart people get wrong about this space is they think the
bottleneck is adjudication speed. It isn't. It's the appeals loop.
We did $60K in ARR last quarter. My co-founder Priya came over from Stripe — she took a big pay cut.
I believed six months ago that we'd sell to hospitals. We don't. We sell to payers.
`.repeat(20); // ~150K-char-scale corpus, like a real run

const idx = buildContextIndex(TRANSCRIPT);

// ══════════════════════════════════════════════════════════════════
// The regression: the old check certified fabrications as "paraphrased"
// ══════════════════════════════════════════════════════════════════

test('verbatim quotes are found', () => {
  assert.equal(classifyQuote('We closed four customers in the first six weeks', idx), 'verbatim');
  assert.equal(classifyQuote("It's the appeals loop", idx), 'verbatim');
});

test('a real paraphrase still passes', () => {
  // Reworded joint, same adjacencies mostly preserved.
  assert.equal(classifyQuote('closed four customers within six weeks', idx), 'paraphrased');
});

test('THE BUG: a fabrication built from words present in the corpus is now caught', () => {
  // Every content word here appears somewhere in the transcript: {lost, four, customers}.
  // The old bag-of-words check returned "paraphrased" — an amber badge certifying a
  // sentence that inverts the founder's actual claim. Adjacency catches it.
  assert.equal(classifyQuote('we lost four customers', idx), 'unverified');
});

test('THE BUG, harder: a reshuffle of real words is not a quote', () => {
  // All present: {claims, operations, hospitals, payers}. None adjacent as stated.
  assert.equal(classifyQuote('claims operations sell hospitals not payers', idx), 'unverified');
});

test('an outright hallucination is unverified', () => {
  assert.equal(classifyQuote('We raised a $12M Series A from Sequoia last month', idx), 'unverified');
});

test('a single content word is never evidence of a quote', () => {
  assert.equal(classifyQuote('adjudication', idx), 'unverified');
  assert.equal(classifyQuote('payers', idx), 'unverified');
});

test('empty and junk quotes are unverified, not crashes', () => {
  assert.equal(classifyQuote('', idx), 'unverified');
  assert.equal(classifyQuote(null, idx), 'unverified');
  assert.equal(classifyQuote('the a an of', idx), 'unverified');
});

test('back-compat: classifyQuote still accepts a raw context string', () => {
  assert.equal(classifyQuote('the appeals loop', TRANSCRIPT), 'verbatim');
});

// ══════════════════════════════════════════════════════════════════
// Number hallucination — the highest-damage fabrication
// ══════════════════════════════════════════════════════════════════

test('numbers present in the source are not flagged', () => {
  assert.deepEqual(unsupportedNumbers('They did $60K in ARR across 4 customers', idx), []);
});

test('an invented ARR figure is flagged', () => {
  const bad = unsupportedNumbers('They are at $250K ARR and growing', idx);
  assert.ok(bad.some((n) => /250/.test(n)), `expected 250K flagged, got ${JSON.stringify(bad)}`);
});

test('single digits are tolerated — they are prose, not claims', () => {
  assert.deepEqual(unsupportedNumbers('There are 2 founders and 3 advisors', idx), []);
});

// ══════════════════════════════════════════════════════════════════
// Wiring
// ══════════════════════════════════════════════════════════════════

test('verifyAllAgents tags team quotes and flags invented numbers in evidence', () => {
  const outputs = {
    team: {
      key_quotes: [
        { quote: 'I ran claims operations at a TPA for six years', read: 'earned insight', signal: 'POSITIVE' },
        { quote: 'We raised $12M from Sequoia', read: 'traction', signal: 'POSITIVE' },
      ],
      subcategories: {
        // Evidence fields were NEVER verified before — and they are what justifies the number.
        sales_capability: { score: 8, evidence: 'Closed 4 customers and is at $999K ARR already.' },
        velocity: { score: 7, evidence: 'Shipped in six weeks.' },
      },
    },
    rubric: {
      movements: {
        earned_insight: { score: 8, evidence: 'Ran claims ops for six years.', quotes: ['I ran claims operations at a TPA for six years'] },
        execution_velocity: { score: 6, evidence: 'Shipped fast.', quotes: ['We deployed to 400 hospitals overnight'] },
      },
    },
  };

  verifyAllAgents(outputs, TRANSCRIPT);

  assert.equal(outputs.team.key_quotes[0].verification, 'verbatim');
  assert.equal(outputs.team.key_quotes[1].verification, 'unverified');
  assert.equal(outputs.team.quote_integrity.has_unverified, true);
  assert.equal(outputs.team.quote_integrity.verbatim, 1);

  // The invented $999K inside an evidence string is caught.
  assert.equal(outputs.team.quote_integrity.has_unsupported_numbers, true);
  assert.ok(outputs.team.subcategories.sales_capability.unsupported_numbers.some((n) => /999/.test(n)));
  assert.equal(outputs.team.subcategories.velocity.unsupported_numbers, undefined);

  // The rubric's quotes matter most — they are behind the only scores that reach conviction.
  assert.equal(outputs.rubric.movements.earned_insight.quote_verification[0].verification, 'verbatim');
  assert.equal(outputs.rubric.movements.execution_velocity.quote_verification[0].verification, 'unverified');
  assert.equal(outputs.rubric.quote_integrity.has_unverified, true);
});

test('verification NEVER changes a score', () => {
  const outputs = {
    team: {
      key_quotes: [{ quote: 'Total fabrication about a $50M round', signal: 'POSITIVE' }],
      subcategories: { sales_capability: { score: 9, evidence: 'Claims $88M ARR.' } },
      pillar_score: 9,
    },
  };
  verifyAllAgents(outputs, TRANSCRIPT);
  assert.equal(outputs.team.pillar_score, 9, 'score untouched');
  assert.equal(outputs.team.subcategories.sales_capability.score, 9, 'score untouched');
  assert.equal(outputs.team.quote_integrity.has_unverified, true, 'but annotated');
});

test('a failed agent is skipped, not crashed on', () => {
  const outputs = { team: { error: 'Agent failed' }, rubric: { error: 'Agent failed' } };
  assert.doesNotThrow(() => verifyAllAgents(outputs, TRANSCRIPT));
});

// ══════════════════════════════════════════════════════════════════════════
// Notation drift: founders speak in shorthand, models write in notation.
//
// Found on the live Cadrian AI call (2026-07-14). Dan Preiss said "We're doing
// it at a 15 post" and "500 committed, another 250 soft committed". The extractor
// faithfully rendered those as "$15M post" and "$500k committed" — and the gate
// discarded BOTH, because "$15m" is not the string "15". The two most important
// facts on a live deal, dropped with the quotes sitting right there proving them.
//
// The mantissa check tolerates the notation while keeping the constraint that
// matters: a claim asserting $15M must still find "15" in its own quote.
// ══════════════════════════════════════════════════════════════════════════
test('a claim may use notation the quote speaks in shorthand', () => {
  const keep = [
    ['The round is priced at a $15M post', "We're doing it at a 15 post"],
    ['They have $500k committed', '500 committed, another 250 soft committed'],
    ['Will take at most $1.25M', 'I think most I will take in is 1.25'],
  ];
  for (const [claim, quote] of keep) {
    assert.deepEqual(
      unsupportedNumbers(claim, buildContextIndex(quote)), [],
      `"${claim}" is supported by "${quote}" — the digits are right there`
    );
  }
});

// The loosening must not open the door it was built to close.
test('an invented number still dies, whatever its notation', () => {
  const drop = [
    ['Reached $60K ARR', 'we have zero revenue and no paying customers'],
    ['Signed 42 customers', 'we closed our first two design partners'],
    // The nastiest: right mantissa, wrong magnitude. "3 million" is not "$300M".
    ['Raising $300M', 'we are raising 3 million dollars'],
  ];
  for (const [claim, quote] of drop) {
    assert.ok(
      unsupportedNumbers(claim, buildContextIndex(quote)).length > 0,
      `"${claim}" must NOT survive "${quote}"`
    );
  }
});
