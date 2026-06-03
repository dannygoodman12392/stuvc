'use strict';
const { test } = require('node:test');
const assert = require('node:assert');
const { _internal, ARCHIVE_KEYS } = require('../services/brief-archive');
const { renderHtml } = require('../services/email-digest');

test('all four archive sources are defined', () => {
  assert.deepStrictEqual([...ARCHIVE_KEYS].sort(), ['chen', 'elad', 'gurley', 'pg']);
});

test('titleFromSlug humanizes a post URL', () => {
  assert.strictEqual(_internal.titleFromSlug('https://abovethecrowd.com/2019/02/27/money-out-of-nowhere/'), 'Money Out Of Nowhere');
  assert.strictEqual(_internal.titleFromSlug('https://andrewchen.com/the-cold-start-problem/'), 'The Cold Start Problem');
});

test('stripHtml removes scripts, styles, tags, entities', () => {
  const html = '<style>.x{}</style><script>evil()</script><p>Hello&nbsp;&amp; welcome &#8217;round</p>';
  const out = _internal.stripHtml(html);
  assert.ok(!/evil|\.x\{/.test(out), 'scripts/styles stripped');
  assert.ok(out.includes('Hello & welcome'), 'entities decoded');
});

test('renderHtml builds a digest with classics and newsletters', () => {
  const digest = {
    date: '2026-06-03',
    classics: [{ author: 'Paul Graham', label: 'PG', title: 'How to Do Great Work', url: 'https://paulgraham.com/greatwork.html', one_liner: 'On doing great work.', takeaways: ['Work on what you are curious about.', 'Earn money to buy freedom.'] }],
    newsletters: [{ source: 'Upstarts', subject: 'AI eats the world', summary: 'A roundup.', key_points: ['Point one', 'Point two'], url: 'https://upstartsmedia.com/p/x' }],
  };
  const html = renderHtml(digest);
  assert.ok(html.includes('Your Daily Brief'));
  assert.ok(html.includes('How to Do Great Work'));
  assert.ok(html.includes('paulgraham.com/greatwork.html'));
  assert.ok(html.includes('Work on what you are curious about.'));
  assert.ok(html.includes('Upstarts'));
  assert.ok(html.includes('AI eats the world'));
});

test('renderHtml degrades gracefully with empty sections', () => {
  const html = renderHtml({ date: '2026-06-03', classics: [], newsletters: [] });
  assert.ok(html.includes('No archive piece today'));
  assert.ok(html.includes('No new newsletter issues'));
});

test('renderHtml escapes HTML in titles (no injection)', () => {
  const html = renderHtml({ date: '2026-06-03', classics: [{ author: 'X', title: '<img src=x onerror=alert(1)>', url: 'https://e.com', takeaways: ['t'] }], newsletters: [] });
  assert.ok(!html.includes('<img src=x'), 'raw tag must be escaped');
  assert.ok(html.includes('&lt;img'), 'escaped form present');
});
