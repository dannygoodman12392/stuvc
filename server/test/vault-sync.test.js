'use strict';
const { test } = require('node:test');
const assert = require('node:assert');
const { timingSafeEqual, mapAgentOutputs } = require('../routes/vaultSync');

test('timingSafeEqual matches identical secrets, rejects wrong ones and length mismatches', () => {
  assert.ok(timingSafeEqual('correct-secret-123', 'correct-secret-123'));
  assert.ok(!timingSafeEqual('correct-secret-123', 'wrong-secret-456789'));
  assert.ok(!timingSafeEqual('short', 'a-much-longer-string'));
  assert.ok(!timingSafeEqual('', 'nonempty'));
});

test('mapAgentOutputs uses the REAL column mapping, not the literal column names', () => {
  // Mirrors the exact remapping in assessments.js:957-961 — DB columns were repurposed from
  // an older 6-agent schema and no longer match their own names. If this drifts, the vault
  // deliverable would silently mislabel Product's analysis as Market's (or vice versa).
  const row = {
    founder_agent_output: JSON.stringify({ verdict: 'team-verdict' }),
    market_agent_output: JSON.stringify({ verdict: 'product-verdict' }),   // holds PRODUCT
    economics_agent_output: JSON.stringify({ verdict: 'market-verdict' }), // holds MARKET
    bear_agent_output: JSON.stringify({ verdict: 'bear-verdict' }),
    pattern_agent_output: null, // confirmed dead — never populated
  };
  const mapped = mapAgentOutputs(row);
  assert.equal(mapped.team.verdict, 'team-verdict');
  assert.equal(mapped.product.verdict, 'product-verdict');
  assert.equal(mapped.market.verdict, 'market-verdict');
  assert.equal(mapped.bear.verdict, 'bear-verdict');
});

test('mapAgentOutputs tolerates missing/malformed columns without throwing', () => {
  const mapped = mapAgentOutputs({});
  assert.deepEqual(mapped, { team: null, product: null, market: null, bear: null });
  const mapped2 = mapAgentOutputs({ founder_agent_output: 'not json' });
  assert.equal(mapped2.team, null);
});
