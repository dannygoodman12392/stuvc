'use strict';
const { test } = require('node:test');
const assert = require('node:assert');
const {
  RUNG,
  computeEvidenceRung,
  computeConviction,
  inputIsReal,
  bandFor,
} = require('../lib/conviction');

// ── helpers ──
const longText = (s) => s + ' '.repeat(0) + 'x'.repeat(200);
const url = (c) => ({ input_type: 'url', label: 'Company Website', content: c || longText('we do things ') });
const deck = (c) => ({ input_type: 'deck', label: 'Pitch Deck', content: c || longText('slide one ') });
const transcript = (c) => ({ input_type: 'transcript', label: 'Call', content: c || longText('founder said ') });
const notes = () => ({ input_type: 'notes', label: 'Analyst Notes', content: longText('my read ') });

const goodMovements = {
  earned_insight: { score: 8, evidence: 'Ran claims ops at a TPA for six years.' },
  execution_velocity: { score: 7, evidence: 'Shipped in three weeks; named two of their own gaps unprompted.' },
  nonconsensus_vision: { score: 6, evidence: 'Thinks payers will insource. Contrarian, tied to a real why-now.' },
  talent_magnetism: { score: 7, evidence: 'Recruited a Stripe staff eng below market, pre-traction.' },
};

// ══════════════════════════════════════════════════════════════════════
// Evidence rung — the facts, computed from inputs, never from the model
// ══════════════════════════════════════════════════════════════════════

test('rung: url only lands at PUBLIC', () => {
  const e = computeEvidenceRung([url()]);
  assert.equal(e.rung, RUNG.PUBLIC);
  assert.equal(e.counts.urls, 1);
});

test('rung: a deck lifts to STATED, a transcript to OBSERVED, two to CORROBORATED', () => {
  assert.equal(computeEvidenceRung([url(), deck()]).rung, RUNG.STATED);
  assert.equal(computeEvidenceRung([url(), deck(), transcript()]).rung, RUNG.OBSERVED);
  assert.equal(computeEvidenceRung([transcript(), transcript()]).rung, RUNG.CORROBORATED);
});

// ══════════════════════════════════════════════════════════════════════
// The meeting-record detector.
//
// The first design gated OBSERVED on `input_type === 'transcript'`. Running it against
// the live database killed that: five of the six companies Stu has ever assessed have
// NO transcript row. Danny writes artifacts elsewhere and pastes them in as `notes` —
// his meeting record lives there. The old gate would have refused to score 5 of 6 real
// companies while looking principled about it.
//
// Every fixture below is the REAL shape of a row in superior-os.db.
// ══════════════════════════════════════════════════════════════════════

const note = (label, content) => ({ input_type: 'notes', label, content: content + ' ' + 'x'.repeat(200) });

test('rung: a generic note does NOT lift — it evidences nothing about the founder', () => {
  assert.equal(computeEvidenceRung([notes()]).rung, RUNG.PUBLIC);
});

test('rung: REAL meeting records in `notes` lift to OBSERVED', () => {
  // Verbatim shapes from the live DB.
  const cases = [
    ['The Graph', 'Meeting Prep - Marina Dedes Gallagher (2026-03-30)', '# Meeting Prep + Debrief: Marina — The Graph\n**Status:** Post-meeting — updated with call notes'],
    ['Gil', 'Founder Assessment - Ashtyn Bell', '# Founder Assessment: Ashtyn Bell — Gil\n**Date:** February 2026 (coffee meeting, ~1 hour)'],
    ['Hale', 'CRM Note', '[Scorecard — Meeting #1] Scored: 2026-02-20 Speed: 3.5/5.0 (High confidence)'],
    ['Gatsby', 'Meeting Notes + Website Research (4/3/2026)', 'Notes from the call plus some desk research.'],
  ];
  for (const [co, label, content] of cases) {
    const e = computeEvidenceRung([note(label, content)]);
    assert.equal(e.rung, RUNG.OBSERVED, `${co}: "${label}" must lift to OBSERVED`);
    assert.equal(e.observed_from.length, 1);
    assert.ok(e.observed_from[0].why, `${co}: must say WHY it lifted — a heuristic has to be auditable`);
  }
});

test('rung: desk research does NOT lift, even from the same founder', () => {
  // The Graph's "Thesis Check" is a five-minute desk filter, not a meeting.
  const e = computeEvidenceRung([note('Thesis Check - The Graph (2026-03-30)', '# Thesis Check: The Graph\n**Round:** $250K SAFE @ $5M post\n## FIVE-MINUTE FILTER\n**Real industry?** Yes')]);
  assert.equal(e.rung, RUNG.PUBLIC);
  assert.equal(e.observed_from.length, 0);
});

test('rung: a CALENDAR note about a meeting is not a meeting record', () => {
  // Real Gil CRM note. Contains the word "meeting" twice and evidences nothing.
  const e = computeEvidenceRung([note('CRM Note', '3/9 - scheduled team meeting for 3/17.  2/23 - meeting scheduled for 2/24.')]);
  assert.equal(e.rung, RUNG.PUBLIC, 'scheduling chatter must not lift the rung');
});

test('rung: notes cap at OBSERVED — they can never claim CORROBORATED', () => {
  // Hale's three CRM notes are all "[Scorecard — Meeting #1]" — ONE meeting written down
  // three times. Counting them as three conversations produced "Corroborated across
  // calls" off a single coffee. Only distinct transcripts can prove more than one call.
  const hale = [
    note('CRM Note', '[Scorecard — Meeting #1] Scored: 2026-02-20T00:18 Speed: 3.5/5.0'),
    note('CRM Note', '[Scorecard — Meeting #1] Scored: 2026-02-20T00:20 Speed: 3.5/5.0'),
    note('CRM Note', '[Scorecard — Meeting #1] Scored: 2026-02-20T00:23 Speed: 3.5/5.0'),
  ];
  const e = computeEvidenceRung(hale);
  assert.equal(e.rung, RUNG.OBSERVED, 'three notes about one meeting is still one meeting');
  assert.equal(e.counts.meeting_records, 3, 'but all three are still reported');
});

test('rung: two real transcripts DO reach CORROBORATED', () => {
  assert.equal(computeEvidenceRung([transcript(), transcript()]).rung, RUNG.CORROBORATED);
});

test('rung: Ghost Social — a thin note correctly refuses to score', () => {
  // The real row: one CRM note, 170 chars total across the whole assessment. The old
  // engine scored it a confident "Pass" twice, 1.1 points apart.
  const e = computeEvidenceRung([{ input_type: 'notes', label: 'CRM Note', content: 'Reached out on LinkedIn. No reply yet. Consumer social, probably not for us.' }]);
  assert.ok(e.rung < RUNG.OBSERVED, 'must not score');
});

test('rung: a failed URL fetch is a gap, not evidence', () => {
  // Stu used to store this literal string as an input and then SCORE it.
  const failed = { input_type: 'url', label: 'acme.com (fetch failed)', content: 'Failed to fetch: HTTP 403' };
  const e = computeEvidenceRung([failed]);
  assert.equal(e.rung, RUNG.NONE, 'a 403 must not count as evidence');
  assert.equal(e.dropped.length, 1);
  assert.match(e.dropped[0].reason, /403/);
});

test('rung: a NOT INGESTED deck is a gap, not evidence', () => {
  const bad = {
    input_type: 'deck',
    label: 'Pitch Deck (NOT INGESTED)',
    content: '[PITCH DECK NOT INGESTED — PDF could not be read: bad xref. The deck content is unavailable]',
  };
  const e = computeEvidenceRung([bad]);
  assert.equal(e.rung, RUNG.NONE);
  assert.equal(e.dropped.length, 1);
  assert.match(e.dropped[0].reason, /PDF could not be read/);
});

test('rung: a real deck plus a broken one still reports the break', () => {
  const bad = { input_type: 'deck', label: 'Old Deck (NOT INGESTED)', content: '[PITCH DECK NOT INGESTED — no readable text was provided]' };
  const e = computeEvidenceRung([deck(), bad]);
  assert.equal(e.rung, RUNG.STATED, 'the good deck still counts');
  assert.equal(e.dropped.length, 1, 'and the broken one is still surfaced');
});

test('inputIsReal rejects fragments', () => {
  assert.equal(inputIsReal({ input_type: 'url', content: 'Home' }), false);
  assert.equal(inputIsReal({ input_type: 'url', content: '' }), false);
  assert.equal(inputIsReal(url()), true);
});

// ══════════════════════════════════════════════════════════════════════
// THE REGRESSION THAT MATTERS
// ══════════════════════════════════════════════════════════════════════

test('a URL-only run produces NO conviction score — never a confident Pass', () => {
  // Before this engine: 2KB of marketing copy scored ~4.3 → "Pass", rendered
  // identically to a Pass earned from a deck and two transcripts. That is the
  // single worst behaviour in the old Assess and this test exists to keep it dead.
  const e = computeEvidenceRung([url()]);
  const c = computeConviction({
    movements: goodMovements, // even if the agents happily returned scores...
    rung: e.rung,
    bearAdjustment: -1.2,
  });

  assert.equal(c.determinate, false, 'must NOT produce a score from a website alone');
  assert.equal(c.score, null);
  assert.equal(c.band, null);
  assert.deepEqual(c.missing_load_bearing, ['Earned Insight', 'Execution & Learning Velocity']);
  assert.match(c.reason, /website only/i);
  assert.match(c.reason, /No conviction score/i);
});

test('a failed fetch produces no conviction and names the gap', () => {
  const failed = { input_type: 'url', label: 'x (fetch failed)', content: 'Failed to fetch: HTTP 403' };
  const e = computeEvidenceRung([failed]);
  const c = computeConviction({ movements: goodMovements, rung: e.rung });
  assert.equal(c.determinate, false);
  assert.equal(e.dropped.length, 1);
});

test('adding a transcript is what unlocks a conviction score', () => {
  const e = computeEvidenceRung([url(), deck(), transcript()]);
  const c = computeConviction({ movements: goodMovements, rung: e.rung });
  assert.equal(c.determinate, true);
  assert.equal(typeof c.score, 'number');
  // base (8+7)/2 = 7.5; differentiator (mean(6,7)-5.5)/4.5 = +0.2 -> 7.7
  assert.equal(c.score, 7.7);
  assert.equal(c.band.key, 'memo');
});

// ══════════════════════════════════════════════════════════════════════
// Abstention is a first-class answer
// ══════════════════════════════════════════════════════════════════════

test('an abstained load-bearing movement kills the score even at a high rung', () => {
  const c = computeConviction({
    rung: RUNG.CORROBORATED,
    movements: { ...goodMovements, earned_insight: { score: null, evidence: 'Never asked how they found the problem.' } },
  });
  assert.equal(c.determinate, false);
  assert.deepEqual(c.missing_load_bearing, ['Earned Insight']);
  assert.match(c.movements.earned_insight.reason, /abstained/i);
});

test('an abstained NON-load-bearing movement still yields a score, minus its weight', () => {
  const c = computeConviction({
    rung: RUNG.OBSERVED,
    movements: { ...goodMovements, talent_magnetism: { score: null } },
  });
  assert.equal(c.determinate, true);
  // base (8+7)/2 = 7.5; only nonconsensus differentiates: (6-5.5)/4.5 = +0.1 → 7.6
  assert.equal(c.score, 7.6);
  assert.equal(c.movements.talent_magnetism.scorable, false);
  assert.ok(c.unscorable.includes('talent_magnetism'));
});

test('nonconsensus_vision is readable at STATED but the others are not', () => {
  const c = computeConviction({ rung: RUNG.STATED, movements: goodMovements });
  assert.equal(c.determinate, false, 'still no score — the load-bearing pair needs a call');
  assert.equal(c.movements.nonconsensus_vision.scorable, true, 'but a deck does assert a thesis');
  assert.equal(c.movements.earned_insight.scorable, false);
  assert.match(c.movements.earned_insight.reason, /needs observed in conversation/i);
});

// ══════════════════════════════════════════════════════════════════════
// GATE, NOT COMPENSATOR.
//
// The rubric: "Weight 1 and 2 (strongest evidence) highest; 3 and 4 DIFFERENTIATE
// among founders who clear 1-2." That is a gate then a tiebreak. The first
// implementation was a flat weighted mean — a compensator — and enumerating all
// 10,000 integer combinations through it showed the rubric inverted:
//
//    10, 10,  1,  1  →  6.4  "Monitor — track the next data point"
//     5,  5, 10, 10  →  7.0  "Top-quartile — write a memo"
//
// 393 of 1,693 memo-band results (23.2%) had a load-bearing movement at 5 or below.
// These tests exist so that can never come back.
// ══════════════════════════════════════════════════════════════════════

const mv = (ei, ev, nv, tm) => ({
  earned_insight: { score: ei }, execution_velocity: { score: ev },
  nonconsensus_vision: { score: nv }, talent_magnetism: { score: tm },
});

test('GATE: perfect on both STRONG movements is Anchor-grade, even with 1s on the MIXED ones', () => {
  const c = computeConviction({ rung: RUNG.CORROBORATED, movements: mv(10, 10, 1, 1) });
  assert.equal(c.score, 9, 'the old mean scored this 6.4 and told Danny to "track it"');
  assert.equal(c.band.key, 'anchor');
});

test('GATE: middling on both STRONG movements can NEVER reach memo, however good 3 and 4 are', () => {
  const c = computeConviction({ rung: RUNG.CORROBORATED, movements: mv(5, 5, 10, 10) });
  assert.ok(c.score < 7, `must not reach memo, got ${c.score}`);
  assert.equal(c.band.key, 'monitor', 'the old mean scored this 7.0 and told Danny to write a memo');
  assert.equal(c.cleared_gate, false);
});

test('GATE: no reachable memo-band score has a load-bearing movement at 5 or below', () => {
  // The exhaustive version of the above. Was 393 combos; must be 0.
  let violations = 0;
  for (let ei = 1; ei <= 10; ei++) for (let ev = 1; ev <= 10; ev++) {
    if (Math.min(ei, ev) > 5) continue;
    for (let nv = 1; nv <= 10; nv++) for (let tm = 1; tm <= 10; tm++) {
      const c = computeConviction({ rung: RUNG.CORROBORATED, movements: mv(ei, ev, nv, tm) });
      if (c.score >= 7) violations++;
    }
  }
  assert.equal(violations, 0, `${violations} combos let weak load-bearing movements reach memo`);
});

test('GATE: movements 3 and 4 can only move the score +-1 — they differentiate, they do not carry', () => {
  const worst = computeConviction({ rung: RUNG.CORROBORATED, movements: mv(8, 8, 1, 1) }).score;
  const best = computeConviction({ rung: RUNG.CORROBORATED, movements: mv(8, 8, 10, 10) }).score;
  assert.equal(best - worst, 2, 'total swing from 3+4 is exactly the +-1 band');
  assert.equal(worst, 7);
  assert.equal(best, 9);
});

test('DOCKS: total docks are capped so an invented number cannot cross two bands', () => {
  // Uncapped these summed to -3.5 — enough to take a 9.0 to a 5.5. None of the
  // magnitudes come from the rubric; they are the author's.
  const c = computeConviction({
    rung: RUNG.CORROBORATED,
    movements: mv(9, 9, 9, 9),
    bearAdjustment: -1.5,
    marketRisk: { structurally_dead: true },
    flags: { charisma_over_substance: true, grievance_grandiosity: true },
  });
  assert.equal(c.dock_capped, true);
  assert.equal(c.docks.reduce((a, d) => a + d.amount, 0), -3.5, 'the docks still REPORT honestly...');
  assert.ok(c.score >= 8, `...but apply capped at -1.5; got ${c.score}`);
  assert.ok(/capped from/.test(c.calculation), 'and the capping is shown, not hidden');
});

test('DOCKS: a full bear no longer closes Anchor-grade entirely', () => {
  // 9,9,9,9 with a working bear used to land at 7.5 — a near-perfect founder could not
  // reach the band whose action is "first call within a week" if the adversary did its job.
  const c = computeConviction({ rung: RUNG.CORROBORATED, movements: mv(9, 9, 9, 9), bearAdjustment: -1.5 });
  assert.equal(c.score, 8.3);
});

test('HONESTY: every conviction result ships the calibration caveat', () => {
  // n=6, no outcome loop, the score never learns. The engine's whole thesis is that a
  // claim gets sized to its evidence — that has to apply to the engine.
  const c = computeConviction({ rung: RUNG.OBSERVED, movements: goodMovements });
  assert.ok(c.calibration, 'a determinate result must carry it');
  assert.match(c.calibration, /never been checked against an outcome/i);
  assert.match(c.calibration, /6 companies/);
  assert.match(c.calibration, /author-set/);
});

test('HONESTY: dock magnitudes are labelled as author-set, not rubric-derived', () => {
  const c = computeConviction({ rung: RUNG.OBSERVED, movements: goodMovements, bearAdjustment: -0.5 });
  assert.match(c.dock_note, /author-set/i);
  assert.match(c.dock_note, /unvalidated/i);
});

// ══════════════════════════════════════════════════════════════════════
// Bands — four, not three
// ══════════════════════════════════════════════════════════════════════

test('bands follow the Founder Rubric: 9-10 anchor / 7-8 memo / 5-6 monitor / <=4 pass', () => {
  assert.equal(bandFor(9.5).key, 'anchor');
  assert.equal(bandFor(9).key, 'anchor');
  assert.equal(bandFor(8.9).key, 'memo');
  assert.equal(bandFor(7).key, 'memo');
  assert.equal(bandFor(6.9).key, 'monitor');
  assert.equal(bandFor(5).key, 'monitor');
  assert.equal(bandFor(4.9).key, 'pass');
  assert.equal(bandFor(1).key, 'pass');
});

test('anchor-grade is reachable and distinct from memo — the old 3-bucket ladder collapsed these', () => {
  const anchor = computeConviction({
    rung: RUNG.CORROBORATED,
    movements: {
      earned_insight: { score: 10 }, execution_velocity: { score: 9 },
      nonconsensus_vision: { score: 9 }, talent_magnetism: { score: 9 },
    },
  });
  assert.equal(anchor.band.key, 'anchor');
  assert.equal(anchor.band.action, 'First call within a week');
});

// ══════════════════════════════════════════════════════════════════════
// The bear stays independent
// ══════════════════════════════════════════════════════════════════════

test('the bear is NOT capped by strong bull scores', () => {
  // The old correctPillarScores capped the bear penalty at -0.5 when team and
  // product both scored high — letting the agents the bear exists to check
  // mechanically silence it. If the bulls are wrong together, the bear must speak.
  const c = computeConviction({
    rung: RUNG.OBSERVED,
    movements: { earned_insight: { score: 9 }, execution_velocity: { score: 9 }, nonconsensus_vision: { score: 9 }, talent_magnetism: { score: 9 } },
    bearAdjustment: -1.5,
  });
  const bearDock = c.docks.find((d) => d.key === 'bear');
  assert.equal(bearDock.amount, -1.5, 'full bear penalty survives a 9-across-the-board team');
  assert.equal(c.score, 8.3);
});

test('bear is clamped to [-1.5, 0] and can never boost', () => {
  const tooLow = computeConviction({ rung: RUNG.OBSERVED, movements: goodMovements, bearAdjustment: -99 });
  assert.equal(tooLow.docks.find((d) => d.key === 'bear').amount, -1.5);

  const positive = computeConviction({ rung: RUNG.OBSERVED, movements: goodMovements, bearAdjustment: 3 });
  assert.equal(positive.docks.find((d) => d.key === 'bear'), undefined, 'a positive bear is not a bonus');
  assert.equal(positive.score, 7.7, 'unchanged from the undocked base');
});

// ══════════════════════════════════════════════════════════════════════
// Market is a weighed risk note, not a 30% pillar
// ══════════════════════════════════════════════════════════════════════

test('a soft market does NOT dock a strong founder', () => {
  // Rubric: "don't discount a strong founder on market alone — great founders
  // navigate and pivot." Stu had market at 30% of the score. That was the drift.
  const c = computeConviction({
    rung: RUNG.OBSERVED,
    movements: goodMovements,
    marketRisk: { structurally_dead: false, note: 'Fragmented, slow-moving buyers.' },
  });
  assert.equal(c.docks.find((d) => d.key === 'market'), undefined);
  assert.equal(c.score, 7.7);
});

test('a structurally dead market docks, but is bounded at -1', () => {
  const c = computeConviction({
    rung: RUNG.OBSERVED,
    movements: goodMovements,
    marketRisk: { structurally_dead: true, note: 'Category is being given away free by the platform.' },
  });
  const dock = c.docks.find((d) => d.key === 'market');
  assert.equal(dock.amount, -1);
  assert.equal(dock.why, 'Category is being given away free by the platform.');
  assert.equal(c.score, 6.7);
});

// ══════════════════════════════════════════════════════════════════════
// Yellow flags dock, never reward
// ══════════════════════════════════════════════════════════════════════

test('yellow flags dock', () => {
  const c = computeConviction({
    rung: RUNG.OBSERVED,
    movements: goodMovements,
    flags: { charisma_over_substance: true, grievance_grandiosity: true },
  });
  assert.equal(c.docks.filter((d) => ['charisma', 'grievance'].includes(d.key)).length, 2);
  assert.equal(c.score, 6.7);
});

test('score is clamped to [1, 10] no matter how many docks pile up', () => {
  const c = computeConviction({
    rung: RUNG.OBSERVED,
    movements: { earned_insight: { score: 2 }, execution_velocity: { score: 2 }, nonconsensus_vision: { score: 1 }, talent_magnetism: { score: 1 } },
    bearAdjustment: -1.5,
    marketRisk: { structurally_dead: true },
    flags: { charisma_over_substance: true, grievance_grandiosity: true },
  });
  assert.ok(c.score >= 1, `clamped at 1, got ${c.score}`);
  assert.equal(c.band.key, 'pass');
});

// ══════════════════════════════════════════════════════════════════════
// Transparency
// ══════════════════════════════════════════════════════════════════════

test('the calculation string shows its work', () => {
  const c = computeConviction({ rung: RUNG.OBSERVED, movements: goodMovements, bearAdjustment: -0.5 });
  assert.match(c.calculation, /Earned Insight 8/);
  assert.match(c.calculation, /base 7\.5/);
  assert.match(c.calculation, /differentiator/);
  assert.match(c.calculation, /-0\.5/);
});

test('every movement carries its evidence strength and what it needs', () => {
  const c = computeConviction({ rung: RUNG.OBSERVED, movements: goodMovements });
  assert.equal(c.movements.earned_insight.evidence_strength, 'STRONG');
  assert.equal(c.movements.talent_magnetism.evidence_strength, 'MIXED');
  assert.equal(c.movements.earned_insight.weight, 3);
  assert.equal(c.movements.talent_magnetism.weight, 2);
});

// ══════════════════════════════════════════════════════════════════════
// The model is an LLM emitting JSON. Fuzzing found real defects here.
// ══════════════════════════════════════════════════════════════════════

const withEI = (score) => ({
  earned_insight: { score },
  execution_velocity: { score: 8 },
  nonconsensus_vision: { score: 8 },
  talent_magnetism: { score: 8 },
});

test('FUZZ: an out-of-range score is a system fault, NOT a plausible verdict', () => {
  // Before the fix: score -5 sailed through and produced conviction 4.1 → "Pass with
  // respect". A nonsense value became a confident rejection with no error anywhere.
  // Wrong-but-believable is precisely what this engine exists to prevent, so it must
  // not sneak back in at the parsing boundary.
  for (const bad of [-5, 0, 11, 99, NaN, Infinity]) {
    const c = computeConviction({ rung: RUNG.CORROBORATED, movements: withEI(bad) });
    assert.equal(c.determinate, false, `score ${bad} must not produce a score`);
    assert.equal(c.system_fault, true, `score ${bad} must be reported as a system fault`);
    assert.equal(c.movements.earned_insight.fault, 'invalid');
    assert.match(c.reason, /system fault/i);
  }
});

test('FUZZ: an out-of-range score is never silently clamped', () => {
  // Clamping 11→10 invents a top score; clamping -5→1 invents a bottom one. Both are
  // the model failing the schema, which means the field cannot be trusted at all.
  const c = computeConviction({ rung: RUNG.CORROBORATED, movements: withEI(11) });
  assert.equal(c.movements.earned_insight.score, null, 'not clamped to 10');
});

test('FUZZ: a quoted number is read, not mistaken for an abstention', () => {
  // Models emit "8" instead of 8. Before the fix this became an abstention, and the UI
  // then told the reader "the agent abstained rather than guess" — a lie. It answered;
  // we failed to read it. A false abstention is as dishonest as a false score.
  const c = computeConviction({ rung: RUNG.CORROBORATED, movements: withEI('8') });
  assert.equal(c.determinate, true);
  assert.equal(c.movements.earned_insight.score, 8);
  assert.equal(c.movements.earned_insight.fault, null);
});

test('FUZZ: the model\'s honest ways of abstaining all read as abstentions', () => {
  for (const v of [null, undefined, 'null', 'N/A', 'n/a', 'unknown', 'none', '']) {
    const c = computeConviction({ rung: RUNG.CORROBORATED, movements: withEI(v) });
    assert.equal(c.movements.earned_insight.fault, 'abstained', `${JSON.stringify(v)} should abstain`);
    assert.equal(c.system_fault, false, `${JSON.stringify(v)} is not a system fault`);
  }
});

test('FUZZ: abstention and system fault give different reasons to the reader', () => {
  const abstained = computeConviction({ rung: RUNG.CORROBORATED, movements: withEI(null) });
  const invalid = computeConviction({ rung: RUNG.CORROBORATED, movements: withEI(-5) });
  assert.match(abstained.reason, /could not find evidence/i);
  assert.equal(abstained.system_fault, false);
  assert.match(invalid.reason, /system fault/i);
  assert.equal(invalid.system_fault, true);
  // "go ask better questions" is the wrong advice when the machine broke.
  assert.ok(!/answered questions/i.test(invalid.reason), 'must not tell the user to go take a call when the fault is ours');
});

test('FUZZ: malformed movements containers degrade to indeterminate, never a score', () => {
  for (const m of [null, undefined, [], 'movements', 42, { earnedInsight: { score: 8 } }]) {
    const c = computeConviction({ rung: RUNG.CORROBORATED, movements: m });
    assert.equal(c.determinate, false, `${JSON.stringify(m)} must not produce a score`);
    assert.equal(c.score, null);
  }
});

test('FUZZ: decimal scores are accepted and rounded', () => {
  const c = computeConviction({ rung: RUNG.CORROBORATED, movements: withEI(8.5) });
  assert.equal(c.determinate, true);
  assert.equal(c.movements.earned_insight.score, 8.5);
});

test('FUZZ: a system fault in a NON-load-bearing movement still kills the score', () => {
  // The nastiest defect the adversarial pass found, and it was inside the engine itself.
  // The system-fault check originally lived only in the indeterminate branch. So if the
  // load-bearing pair parsed fine and only talent_magnetism came back as 11, the bad
  // movement was silently dropped from the weighted average and the remaining three
  // produced determinate=true, score=8, "Top-quartile", reason=null. The only trace was
  // the calculation string reading "/ 8" instead of "/ 10" — and nobody reads a
  // denominator. A confident verdict computed around a broken response is exactly the
  // wrong-but-plausible output this engine exists to prevent.
  for (const bad of [11, 0, -5, 'banana', true, { v: 8 }]) {
    const c = computeConviction({
      rung: RUNG.CORROBORATED,
      movements: {
        earned_insight: { score: 8 },
        execution_velocity: { score: 8 },
        nonconsensus_vision: { score: 8 },
        talent_magnetism: { score: bad }, // weight 2, NOT load-bearing
      },
    });
    assert.equal(c.determinate, false, `talent_magnetism=${JSON.stringify(bad)} must kill the score`);
    assert.equal(c.system_fault, true);
    assert.equal(c.score, null);
    assert.match(c.reason, /system fault/i);
  }
});

test('FUZZ: a determinate result always reports system_fault:false explicitly', () => {
  const c = computeConviction({ rung: RUNG.CORROBORATED, movements: goodMovements });
  assert.equal(c.determinate, true);
  assert.equal(c.system_fault, false, 'the field must exist so consumers can trust it');
});

test('FUZZ: flags do not dock on the STRING "false"', () => {
  // LLM booleans arrive as anything. Raw truthiness meant "false" and "no" both docked
  // 0.5 — a model saying NO cost the founder half a point, and two flags together
  // (-1.0) is enough to cross a band boundary. The score field was hardened and the
  // flags were left raw; that asymmetry was the bug.
  for (const falsey of [false, 'false', 'no', 'No', 0, '0', null, undefined, '']) {
    const c = computeConviction({
      rung: RUNG.OBSERVED,
      movements: goodMovements,
      flags: { charisma_over_substance: falsey, grievance_grandiosity: falsey },
    });
    assert.equal(c.docks.length, 0, `flag=${JSON.stringify(falsey)} must not dock`);
    assert.equal(c.score, 7.7);
  }
});

test('FUZZ: flags DO dock on true and on the string "true"', () => {
  for (const truthy of [true, 'true', 1, '1']) {
    const c = computeConviction({
      rung: RUNG.OBSERVED,
      movements: goodMovements,
      flags: { charisma_over_substance: truthy },
    });
    assert.ok(c.docks.some((d) => d.key === 'charisma'), `flag=${JSON.stringify(truthy)} must dock`);
  }
});

test('FUZZ: structurally_dead docks on the string "true" — it must not fail open', () => {
  // The runner checked `=== true`, so a model emitting "true" meant a structurally dead
  // market was silently ignored with no trace. The library now coerces, so the dock
  // fires regardless of which layer is strict.
  for (const truthy of [true, 'true']) {
    const c = computeConviction({
      rung: RUNG.OBSERVED,
      movements: goodMovements,
      marketRisk: { structurally_dead: truthy, note: 'Platform gives it away free.' },
    });
    assert.ok(c.docks.some((d) => d.key === 'market'), `structurally_dead=${JSON.stringify(truthy)} must dock`);
  }
  for (const falsey of [false, 'false', null, undefined]) {
    const c = computeConviction({
      rung: RUNG.OBSERVED,
      movements: goodMovements,
      marketRisk: { structurally_dead: falsey },
    });
    assert.ok(!c.docks.some((d) => d.key === 'market'), `structurally_dead=${JSON.stringify(falsey)} must not dock`);
  }
});

// ══════════════════════════════════════════════════════════════════════════
// THE GATE'S ACTUAL OUTPUT — pinned, because I misquoted my own file.
//
// conviction.js carries a comment contrasting the old weighted mean's failure
// (10,10,1,1 -> 6.4 "Monitor") with the gate that replaced it. Briefing a review
// panel, I quoted the OLD numbers as if they were the gate's. The panel came back
// with "you pitched us the pathology as the product" — and they were right about
// the quote, wrong about the code.
//
// A comment can be misread. A test cannot. These assert what the code DOES.
// ══════════════════════════════════════════════════════════════════════════
const mv4 = (a, b, c, d) => ({
  earned_insight: { score: a, evidence: 'e' },
  execution_velocity: { score: b, evidence: 'e' },
  nonconsensus_vision: { score: c, evidence: 'e' },
  talent_magnetism: { score: d, evidence: 'e' },
});

test('the gate does NOT invert the rubric — this is the whole design', () => {
  // Perfect on both load-bearing movements, terrible on the two the rubric calls
  // MIXED. The old mean tracked this founder at 6.4. The gate must not.
  const strong = computeConviction({ movements: mv4(10, 10, 1, 1), rung: 4 });
  assert.equal(strong.determinate, true);
  assert.equal(strong.score, 9);
  assert.equal(strong.band.key, 'anchor');

  // Middling on both load-bearing, perfect on the differentiators. The old mean
  // carried this founder to a memo at 7.0. The gate must cap them.
  const carried = computeConviction({ movements: mv4(5, 5, 10, 10), rung: 4 });
  assert.equal(carried.determinate, true);
  assert.equal(carried.score, 6);
  assert.equal(carried.band.key, 'monitor');

  // The invariant, stated plainly: a founder strong where the evidence is strong
  // must outrank one who is merely well-liked.
  assert.ok(strong.score > carried.score, 'the load-bearing movements must set the score');
});

test('the differentiators can move a score by at most ±1', () => {
  // Measure the SPREAD, not the distance from 5,5. My first version of this test
  // compared against mv4(7,7,5,5) — which is 6.9, because 5,5 already carries a
  // -0.1 differentiator — and then complained that the lift was 1.1. The baseline
  // was the bug. Hold the load-bearing pair fixed and swing the other two through
  // their whole range: the total spread is the ±1 band, doubled.
  const worst = computeConviction({ movements: mv4(7, 7, 1, 1), rung: 4 }).score;   // 6.0
  const best = computeConviction({ movements: mv4(7, 7, 10, 10), rung: 4 }).score;  // 8.0
  assert.ok(best - worst <= 2.01, `differentiators swing the score by ${best - worst}, max is 2 (±1)`);

  // And the band must hold: two movements the rubric calls MIXED cannot carry a
  // founder from Monitor to Anchor on their own.
  assert.ok(best < 9, 'the differentiators must never reach anchor-grade alone');
});
