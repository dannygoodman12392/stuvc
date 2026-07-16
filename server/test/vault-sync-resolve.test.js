'use strict';
// ══════════════════════════════════════════════════════════════════════════
// resolveFounderId is the entire safety boundary for Danny's most valuable data.
//
// 80 Granola meetings in 90 days, 28 of which belong to cards on the live board.
// Get the join wrong and a real transcript lands on a stranger's card, fathers
// signals with verbatim quotes, and every one of those quotes verifies — against
// the wrong company. Nothing downstream can catch it.
//
// So the rule is: MORE THAN ONE MATCH IS A REFUSAL. Not a coin flip, not LIMIT 1.
// An unfiled note is a nuisance; a misfiled transcript is a lie with receipts.
//
// The fixtures are the real board and the real Granola titles, 2026-07-16.
// ══════════════════════════════════════════════════════════════════════════

const { test } = require('node:test');
const assert = require('node:assert');
const { resolveFounderId, normCompany, normPerson } = require('../routes/vaultSync');

// The live board, trimmed to the rows that make this hard.
const CARDS = [
  { id: 5516, name: 'Dan Preiss', company: 'Cadrian AI' },
  { id: 5485, name: 'Colton Black', company: 'ONNYX Systesm' },  // typo is real
  { id: 5484, name: 'Maria Cannizzo', company: 'Kelvon' },        // Granola says "Kelvin"
  { id: 5489, name: 'Roy Grossberg', company: 'Uptake AI' },
  { id: 5487, name: 'Sam Oh', company: 'Concorda' },
  { id: 5491, name: 'Luke Button', company: 'Hedge' },
  // 18 cards are literally named "Stealth". Three of them:
  { id: 5334, name: 'Evan Wray', company: 'Stealth' },
  { id: 5506, name: 'Alex Wilson', company: 'Stealth' },
  { id: 5400, name: 'Pat Lin', company: 'Stealth' },
  // The collision pair that normalisation creates on purpose:
  { id: 5515, name: 'Mustafa Alimumal', company: 'Peak' },
  { id: 5901, name: 'Someone Else', company: 'Peak Labs' },
];

// ─────────────────────────── normalisation ───────────────────────────

test('normCompany drops filler so cosmetic drift stops losing real calls', () => {
  // Measured misses on the live board before this existed.
  assert.equal(normCompany('Uptake AI'), normCompany('Uptake'));
  assert.equal(normCompany('Cadrian AI'), 'cadrian');
  assert.equal(normCompany('Permute Technologies, Inc.'), 'permute');
  assert.equal(normCompany('ONNYX Systems'), 'onnyx');
});

test('normalisation does NOT fix typos, and must not try', () => {
  // The live card reads "ONNYX Systesm" — `Systems` misspelt. The noise list strips
  // `systems?`, so the typo survives and the company names genuinely don't match.
  //
  // The fix is NOT fuzzy matching. Edit distance is how "Peak" becomes "Peek" becomes
  // somebody else's transcript; it buys back a handful of joins and pays for them with
  // a failure mode nothing downstream can detect. The person's name resolves this one
  // correctly (see below), and a typo'd company with no name attached SHOULD miss —
  // an unfiled note is a nuisance, a misfiled one is a lie with quotes.
  assert.notEqual(normCompany('Onnyx'), normCompany('ONNYX Systesm'));
  assert.equal(resolveFounderId({ company: 'Onnyx' }, CARDS), null);
});

test('normPerson strips punctuation and case — never words', () => {
  assert.equal(normPerson('Alley  Bellack'), 'alley bellack');
  assert.equal(normPerson('Sam O’Hara'), 'sam o hara');
  // A person's name has no filler. "Dan" and "Daniel" are different people.
  assert.notEqual(normPerson('Dan Preiss'), normPerson('Daniel Preiss'));
});

// ─────────────────────────── the happy joins ───────────────────────────

test('the ordinary case: "Dan Preiss (Cadrian AI)"', () => {
  assert.equal(resolveFounderId({ founder_name: 'Dan Preiss', company: 'Cadrian AI' }, CARDS), 5516);
});

test('a typo in the card no longer loses the call', () => {
  // Granola: "ONNYX (Colton and David)". Card company: "ONNYX Systesm".
  assert.equal(resolveFounderId({ founder_name: 'Colton Black', company: 'Onnyx' }, CARDS), 5485);
  // Granola: "Maria Cannizzo (Kelvin)". Card company: "Kelvon".
  // The COMPANY doesn't match even normalised — the person carries this one.
  assert.equal(resolveFounderId({ founder_name: 'Maria Cannizzo', company: 'Kelvin' }, CARDS), 5484);
});

test('company alone works when it identifies exactly one card', () => {
  // "Concorda <> GLG Call" — no founder name in the title at all.
  assert.equal(resolveFounderId({ company: 'Concorda' }, CARDS), 5487);
});

test('an explicit founder_id always wins', () => {
  assert.equal(resolveFounderId({ founder_id: 999, company: 'Concorda' }, CARDS), 999);
});

// ─────────────────────────── the refusals ───────────────────────────

test('THE BUG THIS REPLACES: "Stealth" no longer resolves to whoever SQLite returns first', () => {
  // The old resolver ended in LIMIT 1. 18 cards are named "Stealth". A placeholder
  // guard covered this one string and nothing else — see the next test.
  assert.equal(resolveFounderId({ company: 'Stealth' }, CARDS), null);
});

test('a placeholder company is rescued by the founder name, not by guessing', () => {
  // "Alex Wilson (Stealth)" is a real, unambiguous join — the NAME carries it.
  assert.equal(resolveFounderId({ founder_name: 'Alex Wilson', company: 'Stealth' }, CARDS), 5506);
});

test('AMBIGUITY IS A REFUSAL, even when it is not a known placeholder', () => {
  // This is the generalisation the placeholder list could never make. Normalising
  // "Peak Labs" -> "peak" is deliberate (it's what catches "ONNYX Systesm"), and it
  // makes Peak and Peak Labs collide. Two matches, so: refuse.
  assert.equal(resolveFounderId({ company: 'Peak' }, CARDS), null);
  // And the name settles it.
  assert.equal(resolveFounderId({ founder_name: 'Mustafa Alimumal', company: 'Peak' }, CARDS), 5515);
});

test('a company nobody has a card for is a refusal, not a nearest guess', () => {
  assert.equal(resolveFounderId({ company: 'Etched' }, CARDS), null);
  assert.equal(resolveFounderId({ founder_name: 'Nate Cooper', company: 'Barrel VC' }, CARDS), null);
});

test('empty / junk input never matches anything', () => {
  assert.equal(resolveFounderId({}, CARDS), null);
  assert.equal(resolveFounderId({ company: '' }, CARDS), null);
  assert.equal(resolveFounderId({ company: 'TBD' }, CARDS), null);
  assert.equal(resolveFounderId({ company: 'Unknown' }, CARDS), null);
  // Normalises to the empty string — must not match every card whose company is junk.
  assert.equal(resolveFounderId({ company: 'Inc' }, CARDS), null);
});

test('a name+company pair that agrees beats a person who also matches alone', () => {
  // Alex Wilson appears once; make sure the both-match branch returns the same card
  // rather than being skipped when the company is a placeholder.
  assert.equal(resolveFounderId({ founder_name: 'Luke Button', company: 'Hedge' }, CARDS), 5491);
  // And "Hedge Insurance (Luke Button)" — where the caller has them swapped — still
  // lands, because the person alone is unambiguous.
  assert.equal(resolveFounderId({ founder_name: 'Luke Button', company: 'Hedge Insurance' }, CARDS), 5491);
});

// ─────────────────────────── reading a Granola title ───────────────────────────

test('parseMeetingTitle produces every reading, because the order is not fixed', () => {
  const { parseMeetingTitle } = require('../routes/vaultSync');
  // Person (Company) — the common case.
  assert.deepEqual(parseMeetingTitle('Dan Preiss (Cadrian AI)'), [
    { founder_name: 'Dan Preiss', company: 'Cadrian AI' },
    { founder_name: 'Cadrian AI', company: 'Dan Preiss' },
  ]);
  // Bare. "Scaylor" is a company, "Alex Wilson" is a person, and nothing in either
  // string says which — so both readings, always. Assuming company-only here is the
  // bug that lost Alex Wilson and Roy Grossberg on the first live pass.
  assert.deepEqual(parseMeetingTitle('Scaylor'), [{ company: 'Scaylor' }, { founder_name: 'Scaylor' }]);
});

test('parseMeetingTitle strips the meeting noise Danny actually types', () => {
  const { parseMeetingTitle } = require('../routes/vaultSync');
  assert.deepEqual(parseMeetingTitle('Concorda <> GLG Call')[0], { company: 'Concorda' });
  assert.deepEqual(parseMeetingTitle('Concorda pitch — litigation intelligence platform')[0], { company: 'Concorda' });
  // A trailing date is not a company.
  assert.deepEqual(parseMeetingTitle('Brandon Cruz (May 1, 2026)')[0], { company: 'Brandon Cruz' });
});

test('the title is only read when nothing explicit was sent', () => {
  const cards = [{ id: 7, name: 'Dan Preiss', company: 'Cadrian AI' }];
  // Explicit fields win — the caller knows more than the title does.
  assert.equal(resolveFounderId({ founder_name: 'Dan Preiss', title: 'Some Other Co' }, cards), 7);
  // Title-only: the server does the parsing, so the scheduled task can stay dumb.
  assert.equal(resolveFounderId({ title: 'Dan Preiss (Cadrian AI)' }, cards), 7);
  assert.equal(resolveFounderId({ title: 'Weekly IC' }, cards), null);
});

test('reading a title never bypasses the refusal rules', () => {
  const cards = [
    { id: 1, name: 'Evan Wray', company: 'Stealth' },
    { id: 2, name: 'Alex Wilson', company: 'Stealth' },
  ];
  // "Michael Dunn (Stealth)" — the exact case from the old bug comment. Neither
  // reading resolves, so it stays unfiled rather than landing on Evan or Alex.
  assert.equal(resolveFounderId({ title: 'Michael Dunn (Stealth)' }, cards), null);
  // But a real person in the title still lands.
  assert.equal(resolveFounderId({ title: 'Alex Wilson' }, cards), 2);
});
