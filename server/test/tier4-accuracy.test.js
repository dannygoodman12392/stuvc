'use strict';
const { test } = require('node:test');
const assert = require('node:assert');
const { canonUrl, normTitle } = require('../services/newsletter');
const { heuristicMatch } = require('../pipeline/match-engine');

// Newsletter cross-source dedup helpers (the same story across newsletters should collapse).
test('canonUrl strips query/fragment/trailing slash', () => {
  assert.strictEqual(canonUrl('https://Stratechery.com/2026/post/?utm=x#a'), 'https://stratechery.com/2026/post');
  assert.strictEqual(canonUrl('https://x.com/a/'), 'https://x.com/a');
});
test('normTitle normalizes headlines so near-identical ones match', () => {
  assert.strictEqual(normTitle('OpenAI’s New Model — Explained!'), 'openais new model explained');
  assert.strictEqual(normTitle('OpenAIs new model explained'), 'openais new model explained');
});

// Talent must-haves now affect the score (previously ignored).
test('heuristicMatch penalizes a candidate missing all must-haves', () => {
  const role = { band: 'B', must_haves: JSON.stringify(['kubernetes', 'fintech']), stack_requirements: '[]', domain_requirements: '[]' };
  const candWith = { overall_score: 8, score_leap_readiness: 8, band_fit: '["B"]', tech_stack: '["Kubernetes"]', builder_signals: '["fintech"]', headline: 'Staff eng' };
  const candWithout = { overall_score: 8, score_leap_readiness: 8, band_fit: '["B"]', tech_stack: '["React"]', builder_signals: '[]', headline: 'Frontend dev' };
  const withScore = heuristicMatch(candWith, role).match_score;
  const withoutScore = heuristicMatch(candWithout, role).match_score;
  assert.ok(withScore > withoutScore, `must-haves should matter: met=${withScore} vs missing=${withoutScore}`);
  assert.ok(heuristicMatch(candWithout, role).gaps.some(g => /must-have/i.test(g)), 'missing must-haves should be a gap');
});
