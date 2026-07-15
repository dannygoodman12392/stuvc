const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');

// ══════════════════════════════════════════════════════════════════════════
// Every route module must actually parse and load.
//
// WHY THIS EXISTS: on 2026-07-15 a stray pair of backticks inside a template
// literal in routes/pipeline.js made the file a syntax error. The server died on
// boot — and the full suite reported 255/255 passing, because not one test ever
// `require`d a route module. Tests were asserting on route source code read as
// TEXT while the real thing couldn't parse.
//
// A green suite over an app that cannot start is worse than no suite: it is a
// confident wrong answer. This is the cheapest possible smoke test — it just
// loads every route — and it would have caught it in 40ms.
// ══════════════════════════════════════════════════════════════════════════

const ROUTES_DIR = path.join(__dirname, '..', 'routes');

function routeFiles(dir, prefix = '') {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
    if (e.isDirectory()) return routeFiles(path.join(dir, e.name), `${prefix}${e.name}/`);
    return e.name.endsWith('.js') ? [`${prefix}${e.name}`] : [];
  });
}

const files = routeFiles(ROUTES_DIR);

test('there are route modules to check', () => {
  assert.ok(files.length > 10, `expected the routes dir to be populated, found ${files.length}`);
});

for (const f of files) {
  test(`routes/${f} parses and exports a router`, () => {
    let mod;
    assert.doesNotThrow(() => {
      mod = require(path.join(ROUTES_DIR, f));
    }, `routes/${f} failed to load — the server cannot boot`);

    // Express routers are functions; a couple of modules export { router, ... }.
    const router = typeof mod === 'function' ? mod : mod && mod.router;
    assert.ok(router, `routes/${f} must export an express router (directly or as .router)`);
  });
}

test('server/lib modules parse', () => {
  const libDir = path.join(__dirname, '..', 'lib');
  for (const f of fs.readdirSync(libDir).filter((x) => x.endsWith('.js'))) {
    assert.doesNotThrow(() => require(path.join(libDir, f)), `lib/${f} failed to load`);
  }
});
