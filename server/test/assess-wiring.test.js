'use strict';
// End-to-end wiring of the scoring path, with the LLM stubbed out.
// The agents' JUDGMENT needs a model; the arithmetic and the gates do not — and the
// arithmetic is the part that must never silently drift. Every case below is a real
// failure this rebuild fixed, pinned so it stays fixed.
const { test } = require('node:test');
const assert = require('node:assert');

const { _internal } = require('../routes/assessments');
const { correctPillarScores, correctSynthesisScores, SCORING_TEMPERATURE, assembleContext } = _internal;
const { computeEvidenceRung, computeConviction, RUNG } = require('../lib/conviction');

// ── fixtures ──
const bigText = (s) => s + ' ' + 'detail '.repeat(60);
const urlInput = () => ({ input_type: 'url', label: 'acme.com', content: bigText('Acme automates claims.') });
const deckInput = () => ({ input_type: 'deck', label: 'Deck', content: bigText('Slide 1: the problem.') });
const transcriptInput = () => ({ input_type: 'transcript', label: 'Call', content: bigText('I ran claims ops for six years.') });

const goodRubric = () => ({
  movements: {
    earned_insight: { score: 8, evidence: 'Ran claims ops at a TPA for six years.' },
    execution_velocity: { score: 7, evidence: 'Shipped in three weeks; named their own gaps.' },
    nonconsensus_vision: { score: 6, evidence: 'Thinks payers insource. Contrarian, real why-now.' },
    talent_magnetism: { score: 7, evidence: 'Recruited a Stripe staff eng below market.' },
  },
  flags: { charisma_over_substance: false, grievance_grandiosity: false },
});

function runScoring({ inputs, rubric, bear = -0.3, market = {}, team, product }) {
  const evidence = computeEvidenceRung(inputs);
  const agentOutputs = {
    team: team || { subcategories: { founder_problem_fit: { score: 8 }, sales_capability: { score: 7 } }, verdict: {} },
    product: product || { subcategories: { product_velocity: { score: 4 }, customer_proximity: { score: 5 } } },
    market: { subcategories: { market_timing: { score: 6 } }, ...market },
    bear: { bear_adjustment: bear },
    rubric,
  };
  correctPillarScores(agentOutputs);
  const conviction = computeConviction({
    movements: rubric?.error ? {} : (rubric?.movements || {}),
    rung: evidence.rung,
    marketRisk: { structurally_dead: agentOutputs.market.structurally_dead === true, note: agentOutputs.market.kill_shot_risk },
    bearAdjustment: agentOutputs.bear.bear_adjustment,
    flags: (rubric?.error ? {} : rubric?.flags) || {},
  });
  const synthesis = {};
  correctSynthesisScores(synthesis, agentOutputs, conviction);
  return { evidence, agentOutputs, conviction, synthesis };
}

// ══════════════════════════════════════════════════════════════════
// The headline regression
// ══════════════════════════════════════════════════════════════════

test('WIRING: a URL-only run yields NO score and an explicit gap — not a Pass', () => {
  const { synthesis, conviction } = runScoring({ inputs: [urlInput()], rubric: goodRubric() });
  assert.equal(synthesis.overall_score, null);
  assert.equal(synthesis.overall_signal, 'Insufficient evidence');
  assert.equal(synthesis.recommended_next_step, 'Take the call');
  assert.match(synthesis.insufficient_evidence_reason, /website only/i);
  assert.equal(conviction.determinate, false);
  // The old behaviour: ~4.3 → "Pass", pixel-identical to a real Pass.
  assert.notEqual(synthesis.overall_signal, 'Pass');
});

test('WIRING: a run with a transcript produces a real band', () => {
  const { synthesis, conviction } = runScoring({ inputs: [urlInput(), deckInput(), transcriptInput()], rubric: goodRubric() });
  assert.equal(conviction.determinate, true);
  assert.equal(synthesis.overall_score, 7.4); // base 7.5 + differentiator 0.2 - 0.3 bear
  assert.equal(synthesis.overall_signal, 'Top-quartile');
  assert.equal(synthesis.recommended_next_step, 'Write a memo');
});

// ══════════════════════════════════════════════════════════════════
// A dead agent is an error, not a judgment
// ══════════════════════════════════════════════════════════════════

test('WIRING: a crashed rubric agent yields no score, not a Pass', () => {
  const { conviction } = runScoring({
    inputs: [urlInput(), transcriptInput()],
    rubric: { error: 'Could not parse JSON output' },
  });
  assert.equal(conviction.determinate, false);
  assert.equal(conviction.score, null);
});

test('WIRING: a crashed TEAM agent no longer drags the score to Pass', () => {
  // The old bug: `(teamScore || 0) * 0.45` meant a dead Team agent contributed 0,
  // dropped the total ~3.4 points, and flipped the verdict to "Pass" — while the UI
  // hid the Team card because the value was null. Infrastructure failure and negative
  // judgment produced an identical screen. Team no longer touches conviction at all.
  const { synthesis, conviction } = runScoring({
    inputs: [urlInput(), transcriptInput()],
    rubric: goodRubric(),
    team: { error: 'Agent failed' },
  });
  assert.equal(conviction.determinate, true, 'conviction survives a dead depth-layer agent');
  assert.equal(synthesis.overall_score, 7.4);
  assert.equal(synthesis.pillar_scores.team, null, 'and the dead pillar reports as null, not 0');
});

// ══════════════════════════════════════════════════════════════════
// The Graph regression — the average used to eat an Invest
// ══════════════════════════════════════════════════════════════════

test('WIRING: a low product score can no longer bury a strong founder', () => {
  // Verified from the live DB, assessment id 16 (The Graph, a company Danny angel-backed):
  // Team agent returned {"signal":"Invest","score":8,...}, agent_consensus found a real
  // regulatory moat, and the composite printed 5.8 "Monitor" because product=4.6 dragged
  // the 45/25/30 average down on a pre-product company. Product no longer votes.
  const { synthesis, conviction } = runScoring({
    inputs: [transcriptInput()],
    rubric: goodRubric(),
    product: { subcategories: { product_velocity: { score: 2 }, customer_proximity: { score: 2 } } },
  });
  assert.equal(conviction.determinate, true);
  assert.equal(synthesis.overall_score, 7.4, 'unchanged by a terrible product score');
  assert.equal(synthesis.pillar_scores.product, 2, 'product still reported as depth');
});

test('WIRING: a soft market does not dock; only a structurally dead one does', () => {
  const soft = runScoring({ inputs: [transcriptInput()], rubric: goodRubric(), market: { structurally_dead: false } });
  assert.equal(soft.synthesis.overall_score, 7.4);

  const dead = runScoring({
    inputs: [transcriptInput()],
    rubric: goodRubric(),
    market: { structurally_dead: true, kill_shot_risk: 'Platform gives this away free.' },
  });
  assert.equal(dead.synthesis.overall_score, 6.4, 'exactly -1, once');
  assert.ok(dead.conviction.docks.some((d) => d.key === 'market'));
});

// ══════════════════════════════════════════════════════════════════
// The bear is no longer muzzled by the bulls
// ══════════════════════════════════════════════════════════════════

test('WIRING: correctPillarScores no longer caps the bear on high traction', () => {
  // The old ceiling: team>=7.5 && velocity>=7 && proximity>=7 → bear capped at -0.5.
  // The traction that tripped it came from a forced score off a slide claim.
  const outputs = {
    team: { subcategories: { founder_problem_fit: { score: 9 }, sales_capability: { score: 9 } } },
    product: { subcategories: { product_velocity: { score: 9 }, customer_proximity: { score: 9 } } },
    bear: { bear_adjustment: -1.5 },
  };
  correctPillarScores(outputs);
  assert.equal(outputs.bear.bear_adjustment, -1.5, 'full bear survives a 9-across-the-board company');
});

test('WIRING: correctPillarScores no longer floors the bear on thin evidence', () => {
  // The old floor: velocity < 5 → bear forced to at least -0.7. That punished absence
  // of evidence as though it were a finding. The evidence rung handles that honestly now.
  const outputs = {
    team: { subcategories: { founder_problem_fit: { score: 5 } } },
    product: { subcategories: { product_velocity: { score: 2 } } },
    bear: { bear_adjustment: -0.1 },
  };
  correctPillarScores(outputs);
  assert.equal(outputs.bear.bear_adjustment, -0.1, 'a mild bear stays mild');
});

// ══════════════════════════════════════════════════════════════════
// The synthesis agent cannot move its own number
// ══════════════════════════════════════════════════════════════════

test('WIRING: a synthesis override is discarded', () => {
  // The old ±1 override was a loophole through every deterministic guarantee: an agent
  // that can move its own score by a point can reach any conclusion and narrate backwards.
  const synthesis = { override: { adjustment: 1, justification: 'I really like them' }, overall_score: 9.9 };
  const conviction = computeConviction({ rung: RUNG.OBSERVED, movements: goodRubric().movements });
  correctSynthesisScores(synthesis, { team: {}, product: {}, market: {}, bear: {} }, conviction);
  assert.equal(synthesis.override, undefined, 'override stripped');
  assert.equal(synthesis.overall_score, 7.7, 'code wins');
});

// ══════════════════════════════════════════════════════════════════
// Determinism + context assembly
// ══════════════════════════════════════════════════════════════════

test('WIRING: scoring temperature is pinned to 0', () => {
  // Verified in the live DB: with no temperature set, byte-identical inputs produced
  // different scores (Ghost Social 2.8 → 1.7 on the same 170 chars).
  assert.equal(SCORING_TEMPERATURE, 0);
});

test('WIRING: assembleContext reports what it dropped rather than cutting silently', () => {
  const { context, notes } = assembleContext('HEADER', [
    { priority: 1, label: 'CALL TRANSCRIPT 1', content: 'x'.repeat(500) },
    { priority: 4, label: 'CRM NOTES', content: 'y'.repeat(5000) },
  ], 1000);
  assert.ok(context.includes('CALL TRANSCRIPT 1'), 'priority 1 is protected');
  assert.ok(notes.length > 0, 'and the trim is reported, not swallowed');
  assert.ok(notes.some((n) => /CRM NOTES/.test(n)));
});

test('WIRING: a failed fetch stored as an input never counts as evidence', () => {
  const inputs = [
    { input_type: 'url', label: 'acme.com (fetch failed)', content: 'Failed to fetch: HTTP 403' },
    transcriptInput(),
  ];
  const e = computeEvidenceRung(inputs);
  assert.equal(e.rung, RUNG.OBSERVED, 'the transcript still counts');
  assert.equal(e.counts.urls, 0, 'the 403 does not');
  assert.equal(e.dropped.length, 1, 'and it is surfaced to the reader');
});
