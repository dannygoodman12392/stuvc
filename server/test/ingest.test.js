const test = require('node:test');
const assert = require('node:assert');
const { ingestUrl } = require('../lib/ingest');

// ══════════════════════════════════════════════════════════════════════════
// A LOGIN WALL IS NOT A SOURCE.
//
// Caught on the first real use of the card's URL box: cadrian.ai returned
// "Sign in | Cadrian", 269 chars, and was ACCEPTED — because the only test was
// length, and 269 > 80. That's the exact failure LinkedIn is blocked for ("a
// login wall HAS text, so it would sail through as a source and produce
// confident signals about nothing"), let in through the front door for every
// other host, two hours after writing the reason down.
//
// The first fix over-corrected and refused the REAL permute.ai page, because
// "Sign in" appears in its nav. A guard that blocks real sources gets switched
// off — worse than the bug. The tell isn't that auth words appear; it's that
// they're all there is.
// ══════════════════════════════════════════════════════════════════════════

const stub = (title, text) => ({
  exaKey: 'test',
  post: async () => ({ status: 200, data: { results: [{ title, url: 'https://x.com', text }] } }),
});

test('a login wall is refused, however much text it has', async () => {
  const r = await ingestUrl({
    founderId: 1, url: 'https://cadrian.ai',
    deps: stub('Sign in | Cadrian', 'Sign in to Cadrian. Continue with Google. Forgot password? Create an account to get started.'),
  });
  assert.ok(r.error, 'must refuse');
  assert.match(r.error, /login or error page/);
});

test('404s and JS shells are refused', async () => {
  for (const [title, text] of [
    ['404 Not Found', 'Page not found. The page you are looking for does not exist.'],
    ['App', 'You need to enable JavaScript to run this app. Please enable it and reload.'],
  ]) {
    const r = await ingestUrl({ founderId: 1, url: 'https://x.com', deps: stub(title, text) });
    assert.ok(r.error, `must refuse "${title}"`);
  }
});

// The regression the over-correction caused. This is the REAL permute.ai shape:
// 5.5K of content with "Sign in" somewhere in the nav.
test('a real page with a login link in the nav is ACCEPTED', async () => {
  const real =
    'The AI Context Platform that ensures you can trust your AI. Sign in is available in the top nav. ' +
    'Connects, contextualizes, and governs everything in between. '.repeat(40);
  const r = await ingestUrl({ founderId: 1, url: 'https://permute.ai', deps: stub('Your Agentic data team', real) });
  assert.ok(!r.error, `must accept a real page — got: ${r.error}`);
});

test('LinkedIn never reaches Exa at all', async () => {
  let called = false;
  const r = await ingestUrl({
    founderId: 1, url: 'https://www.linkedin.com/company/acme',
    deps: { exaKey: 'test', post: async () => { called = true; return { status: 200, data: { results: [] } }; } },
  });
  assert.ok(r.error, 'must refuse');
  assert.match(r.error, /blocks crawlers/);
  assert.equal(called, false, 'must not spend an Exa call to learn what we already know');
});

test('an empty read is a failure, not an empty source', async () => {
  const r = await ingestUrl({ founderId: 1, url: 'https://x.com', deps: stub('Thing', 'tiny') });
  assert.ok(r.error);
  assert.match(r.error, /almost no text/);
});

test('dormant without an Exa key — and it never calls out', async () => {
  let called = false;
  const r = await ingestUrl({
    founderId: 1, url: 'https://x.com',
    deps: { exaKey: null, post: async () => { called = true; return { status: 200, data: { results: [] } }; } },
  });
  assert.match(r.error, /No Exa key/);
  assert.equal(called, false);
});
