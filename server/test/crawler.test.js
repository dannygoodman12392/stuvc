'use strict';
// Pure-function tests for the crawler. No network — the fetch path is exercised by hand
// against real sites (results recorded in the commit message), but the decisions it makes
// are logic and should be pinned.
const { test } = require('node:test');
const assert = require('node:assert');
const cheerio = require('cheerio');
const { extractText, looksClientRendered, discoverLinks } = require('../agents/urlFetcher');

// ══════════════════════════════════════════════════════════════════════
// The bug that made every URL feature in Stu hollow: an empty read
// reported as success.
// ══════════════════════════════════════════════════════════════════════

test('a JS app shell is detected as unreadable, not returned as success', () => {
  // This is what a plain fetch of a React/Next site actually returns. The old fetcher
  // stripped it to ~nothing and handed back { text: '', error: null } — and the agents
  // scored the nothing.
  const shell = '<html><head><title>Acme</title></head><body><div id="__next"></div><script src="/_next/static/chunk.js"></script></body></html>';
  const $ = cheerio.load(shell);
  const text = extractText($);
  assert.ok(looksClientRendered(text, shell), 'a Next.js shell must be flagged as unreadable');
});

test('a real page with content is NOT flagged as client-rendered', () => {
  const html = `<html><body><main>${'We automate claims adjudication for mid-market payers. '.repeat(30)}</main></body></html>`;
  const $ = cheerio.load(html);
  const text = extractText($);
  assert.ok(text.length > 500);
  assert.equal(looksClientRendered(text, html), false);
});

test('a thin page IS flagged even without a framework marker — a slogan is not a read', () => {
  const html = '<html><body><main>Coming soon.</main></body></html>';
  const $ = cheerio.load(html);
  assert.ok(looksClientRendered(extractText($), html));
});

// ══════════════════════════════════════════════════════════════════════
// extractText — cheerio, not regex
// ══════════════════════════════════════════════════════════════════════

test('extractText drops chrome that carries no signal', () => {
  const html = `<html><body>
    <nav>Home About Pricing Login</nav>
    <header>Acme Inc</header>
    <script>window.__DATA__={a:1}</script>
    <style>.x{color:red}</style>
    <main>The actual proposition lives here.</main>
    <footer>© 2026 Acme · Privacy · Terms</footer>
  </body></html>`;
  const text = extractText(cheerio.load(html));
  assert.match(text, /actual proposition/);
  for (const noise of ['Login', '__DATA__', 'color:red', 'Privacy']) {
    assert.ok(!text.includes(noise), `"${noise}" should have been stripped`);
  }
});

test('extractText prefers <main> over the whole body', () => {
  const html = '<html><body><div>sidebar junk</div><main>the signal</main></body></html>';
  assert.equal(extractText(cheerio.load(html)), 'the signal');
});

// ══════════════════════════════════════════════════════════════════════
// Link discovery — the pages where a marketing site tells the truth
// ══════════════════════════════════════════════════════════════════════

const linkPage = (hrefs) => cheerio.load(`<html><body>${hrefs.map((h) => `<a href="${h}">x</a>`).join('')}</body></html>`);

test('discoverLinks finds the high-signal pages and ranks pricing first', () => {
  const $ = linkPage(['/blog/hello', '/pricing', '/about', '/careers', '/customers']);
  const links = discoverLinks($, 'https://acme.com/');
  assert.equal(links[0].kind, 'pricing', 'pricing is the densest page a company has');
  const kinds = links.map((l) => l.kind);
  for (const k of ['pricing', 'about', 'careers', 'customers', 'blog']) {
    assert.ok(kinds.includes(k), `should discover ${k}`);
  }
  // blog is the least informative of the set
  assert.equal(kinds[kinds.length - 1], 'blog');
});

test('discoverLinks stays on-origin and skips assets and junk protocols', () => {
  const $ = linkPage([
    '/pricing',
    'https://twitter.com/acme/pricing', // off-origin
    'https://acme.com/deck.pdf',        // asset
    'mailto:hi@acme.com',
    'tel:+15551234',
    'javascript:void(0)',
    '#anchor',
  ]);
  const links = discoverLinks($, 'https://acme.com/');
  assert.equal(links.length, 1);
  assert.equal(links[0].url, 'https://acme.com/pricing');
});

test('discoverLinks ignores paths with no signal', () => {
  const $ = linkPage(['/login', '/terms', '/random-marketing-page']);
  assert.equal(discoverLinks($, 'https://acme.com/').length, 0, 'only fetch pages worth a request');
});

test('discoverLinks dedupes to one URL per kind', () => {
  const $ = linkPage(['/pricing', '/plans', '/price']);
  const links = discoverLinks($, 'https://acme.com/');
  assert.equal(links.filter((l) => l.kind === 'pricing').length, 1);
});

test('discoverLinks does not re-fetch the homepage', () => {
  const $ = linkPage(['https://acme.com/', 'https://acme.com', '/pricing']);
  const links = discoverLinks($, 'https://acme.com/');
  assert.equal(links.length, 1);
  assert.equal(links[0].kind, 'pricing');
});
