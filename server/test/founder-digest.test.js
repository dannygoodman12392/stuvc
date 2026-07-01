'use strict';
const { test } = require('node:test');
const assert = require('node:assert');
const { gather, renderHtml } = require('../services/founder-digest');

test('founder-digest gather runs valid SQL (empty local DB ok)', () => {
  const data = gather(1, { days: 7 });
  assert.ok(Array.isArray(data.top));
  assert.ok(data.counts && typeof data.counts.totalWeek === 'number');
});

test('founder-digest renders the week\'s breakout founders', () => {
  const html = renderHtml({
    top: [
      { name: 'Angelo Torres', company: 'Stealth', source: 'pre_program', breakout_score: 72,
        breakout_signals: JSON.stringify(['elite background: jane street', 'elite Illinois school', 'actively building']),
        chicago_connection: 'current: Chicago', linkedin_url: 'https://linkedin.com/in/angelo', headline: 'Math & CS @ UChicago, ex-Jane Street' },
    ],
    counts: { totalWeek: 120, preProgram: 18, ilWeek: 40 },
  });
  assert.match(html, /Breakout Radar/);
  assert.match(html, /Angelo Torres/);
  assert.match(html, /72/);                        // breakout score shown
  assert.match(html, /jane street/i);              // evidence signal shown
  assert.match(html, /18 under-the-radar/);        // weekly count
  assert.match(html, /linkedin\.com\/in\/angelo/); // reach-out link
});
