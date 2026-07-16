'use strict';
const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');

function read(p) { return fs.readFileSync(path.join(__dirname, '..', p), 'utf8'); }
const SRC = read('services/card-backfill.js');
const ROUTE = read('routes/pipeline.js');

// ── 1. A SELF-CONSUMING QUEUE MUST NOT BE PAGED BY OFFSET ──
// This shipped and skipped a third of the work. extractAll's list is "sources not
// yet read", so every source it reads leaves the list. The caller walked
// offset 0,4,8… while `considered` fell 89 → 76 → 68 → 64 → 60, and the window
// advanced past sources the shrinking list had moved behind it. Result: 97 cards
// with evidence, 41 with signals, 56 sources silently never read — and the job
// reported done=true.
test('extractAll takes no offset — it always reads from the head of the queue', () => {
  const start = SRC.indexOf('async function extractAll(');
  assert.ok(start > -1, 'extractAll must exist');
  const body = SRC.slice(start, SRC.indexOf('\nmodule.exports', start));

  const sig = body.match(/async function extractAll\(\{[^}]*\}/)[0];
  assert.ok(!/offset/.test(sig), 'extractAll must not accept an offset — its work list empties as it reads');
  assert.ok(!/\.slice\(offset/.test(body), 'no offset-windowing over the extraction queue');

  // ingestWebsites MAY use an offset, and the distinction is the whole lesson: its
  // list is every card with a website — read or not — so nothing moves under it.
  // A stable list pages fine. A queue that empties does not.
  assert.ok(/\.slice\(offset, end\)/.test(SRC.slice(0, start)),
    'ingestWebsites still pages by offset, which is correct for a stable list');

  // And the route must not pass one either.
  const ep = ROUTE.match(/router\.post\('\/extract-signals'[\s\S]*?\n\}\);/);
  assert.ok(ep, 'the extract endpoint must exist');
  assert.ok(!/offset:/.test(ep[0]), 'the extract endpoint must not forward an offset');
});

// ── 2. `done` MUST BE MEASURED, NOT INFERRED ──
// The old `done` was window arithmetic over a moving list, so it claimed completion
// while 56 sources were unread. If a job says it is finished, that has to be a fact
// it checked after its own writes.
test('done is derived from a re-queried remaining count', () => {
  assert.ok(/out\.remaining = db\.prepare\(/.test(SRC), 'remaining must be re-queried after the writes');
  assert.ok(/out\.done = out\.remaining === 0/.test(SRC), 'done must be derived from the measured remaining count');
});

// ── 3. "READ" IS NOT "PRODUCED SIGNALS" ──
// Defining the queue as "sources with no signals" means a source that legitimately
// yields nothing — a thin landing page, a note with no claims — never leaves the
// queue, and is re-read and re-billed on every run forever.
test('the queue is keyed on signals_extracted_at, not on the absence of signals', () => {
  assert.ok(/s\.signals_extracted_at IS NULL/.test(SRC), 'the queue must select on the read marker');
  assert.ok(
    !/NOT EXISTS \(SELECT 1 FROM company_signals g WHERE g\.source_id = s\.id\)/.test(SRC),
    'the queue must not be defined as "has no signals" — zero-yield sources would loop forever'
  );
  assert.ok(
    /UPDATE company_sources SET signals_extracted_at = CURRENT_TIMESTAMP/.test(SRC),
    'a source must be marked read after extraction, whatever it yielded'
  );
});

// ── 4. A TRANSPORT ERROR IS NOT A READ ──
// No API key or a provider outage must leave the source in the queue for a retry.
// Marking it read would silently drop it forever over a transient failure.
test('an extraction error leaves the source unread for a retry', () => {
  const loop = SRC.slice(SRC.indexOf('for (const s of batch)'));
  const errLine = loop.match(/if \(error\) \{[^\n]*\n/);
  assert.ok(errLine, 'the error branch must exist');
  assert.ok(/continue;/.test(errLine[0]), 'an error must continue BEFORE the read marker is set');
  // The marker must come after the error guard, not before it.
  assert.ok(
    loop.indexOf('if (error)') < loop.indexOf('signals_extracted_at = CURRENT_TIMESTAMP'),
    'the read marker must not be set on a failed extraction'
  );
});

// ── 5. THE SPEND CEILING STOPS BEFORE THE CALL, NOT AFTER ──
test('the cap is checked before the billable call', () => {
  const loop = SRC.slice(SRC.indexOf('for (const s of batch)'));
  assert.ok(
    loop.indexOf('stoppedOnCap = true') < loop.indexOf('await extractFrom'),
    'the cap must break BEFORE extractFrom is called — a cap checked after is a receipt'
  );
});

// ── 6. COUNTS DESCRIBE WHAT SURVIVED THE GATE ──
// A category count that includes claims the honesty gate threw away describes a card
// that does not exist.
test('byKind counts kept signals, not proposed ones', () => {
  assert.ok(/for \(const c of r\.signals \|\| \[\]\) out\.byKind/.test(SRC),
    'byKind must be built from r.signals (kept), not from the model\'s candidates');
});
