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

// ══════════════════════════════════════════════════════════════════════════
// A meeting's identity is its ID, not its transcript text.
//
// Caught on PRODUCTION 2026-07-16: one Cadrian call landed twice —
//   id=106 uri=granola:ba38465a-… signals=11
//   id=107 uri=granola:ba38465a-… signals=10
// Same meeting, same Granola id, two rows, because the pushes carried slightly
// different text. The card then claimed 21 facts from one conversation: the same
// claims counted twice, each with a genuine verbatim quote. Every receipt checks
// out and the total is false — the worst shape of wrong this codebase can produce.
// ══════════════════════════════════════════════════════════════════════════
test('the same Granola call pushed with DIFFERENT text is one source, not two', () => {
  const db = require('../db');
  const fid = db.prepare(
    `INSERT INTO founders (name, company, created_by, is_deleted) VALUES ('Dedupe Probe', 'Dedupe Co', 1, 0)`
  ).run().lastInsertRowid;

  const { ingestGranolaNote } = require('../lib/ingest');
  const id = 'granola-dedupe-uuid-001';

  const a = ingestGranolaNote({
    founderId: fid, title: 'Founder (Dedupe Co)', granolaId: id,
    text: 'The founder said they have four hundred thousand in committed capital and two customers.',
  });
  // Granola re-processes transcripts — speaker labels, corrections. Same call,
  // different bytes. This is the real-world case, not a contrived one.
  const b = ingestGranolaNote({
    founderId: fid, title: 'Founder (Dedupe Co)', granolaId: id,
    text: 'Dan: The founder said they have four hundred thousand in committed capital and two customers. [corrected]',
  });

  assert.equal(a.created, true, 'first push creates');
  assert.equal(b.created, false, 'second push of the SAME meeting must not create a second row');
  assert.equal(b.id, a.id, 'it resolves to the same source');

  const n = db.prepare('SELECT COUNT(*) c FROM company_sources WHERE founder_id = ? AND kind = ?').get(fid, 'granola').c;
  assert.equal(n, 1, 'one meeting, one source — however many times the nightly task re-pushes it');

  db.prepare('DELETE FROM company_sources WHERE founder_id = ?').run(fid);
  db.prepare('DELETE FROM founders WHERE id = ?').run(fid);
});

test('two DIFFERENT calls with the same founder both land', () => {
  // The inverse guard: ONNYX really did have two calls (5/1 and 5/5). Deduping on
  // uri must not collapse genuinely distinct meetings.
  const db = require('../db');
  const fid = db.prepare(
    `INSERT INTO founders (name, company, created_by, is_deleted) VALUES ('Two Calls', 'Two Co', 1, 0)`
  ).run().lastInsertRowid;
  const { ingestGranolaNote } = require('../lib/ingest');

  const a = ingestGranolaNote({ founderId: fid, title: '1st call', granolaId: 'uuid-aaa', text: 'First conversation about the product roadmap and hiring plans in detail.' });
  const b = ingestGranolaNote({ founderId: fid, title: '2nd call', granolaId: 'uuid-bbb', text: 'Second conversation, six weeks later, about the raise and the new customer.' });

  assert.equal(a.created, true);
  assert.equal(b.created, true, 'a different meeting is a different source');
  assert.notEqual(a.id, b.id);

  db.prepare('DELETE FROM company_sources WHERE founder_id = ?').run(fid);
  db.prepare('DELETE FROM founders WHERE id = ?').run(fid);
});
