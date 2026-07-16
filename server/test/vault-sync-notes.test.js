'use strict';
const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');

function read(p) { return fs.readFileSync(path.join(__dirname, '..', p), 'utf8'); }
const SRC = read('routes/vaultSync.js');

// This endpoint decides WHOSE CARD Danny's words land on. A wrong match doesn't
// fail — it files a real note about one company onto another founder's card, where
// it then fathers signals whose quotes verify perfectly against the wrong company.

// ── 1. THE PLACEHOLDER GUARD ──
// "Stealth" is the company name on 18 of Danny's founders and "Not Yet" on 3. The
// old /call-notes matcher fell back to company name with no guard, so a Granola call
// titled "Michael Dunn (Stealth)" would land on whichever Stealth founder came back
// first.
// Rewritten to assert BEHAVIOUR rather than grep the source. The original matched
// the literal text of the guard regex, which meant it went red the moment the
// implementation was improved and green for any code that merely CONTAINED the
// right-looking string. resolveFounderId is exported now, so the real question —
// "does a placeholder company file a note on a stranger's card?" — is askable
// directly. Full coverage lives in vault-sync-resolve.test.js.
test('company-name fallback refuses placeholder names', () => {
  const { resolveFounderId } = require('../routes/vaultSync');
  const cards = [
    { id: 1, name: 'Evan Wray', company: 'Stealth' },
    { id: 2, name: 'Alex Wilson', company: 'Stealth' },
    { id: 3, name: 'Stealth Person', company: 'Real Co' },
  ];
  assert.equal(resolveFounderId({ company: 'Stealth' }, cards), null, 'a placeholder company must never resolve');
  assert.equal(resolveFounderId({ company: 'Not Yet' }, cards), null);
  // The guard belongs on the company branch, not the name branch — a founder NAMED
  // "Stealth" isn't the problem; a company called it is.
  assert.equal(resolveFounderId({ founder_name: 'Stealth Person' }, cards), 3, 'a person named Stealth is still a person');
  // And the name rescues the placeholder rather than guessing past it.
  assert.equal(resolveFounderId({ founder_name: 'Alex Wilson', company: 'Stealth' }, cards), 2);
});

// ── 2. ONE MATCHER, NOT TWO ──
// /notes and /call-notes both decide the same question. Two copies is two sets of
// rules to drift apart, and the weaker one was already wrong.
test('both note endpoints use the same matcher', () => {
  const notes = SRC.match(/router\.post\('\/notes'[\s\S]*?\n\}\);/);
  const calls = SRC.match(/router\.post\('\/call-notes'[\s\S]*?\n\}\);/);
  assert.ok(notes && calls, 'both endpoints must exist');
  assert.ok(/resolveFounderId\(r(?:,\s*cards)?\)/.test(notes[0]), '/notes must use the shared matcher');
  assert.ok(/resolveFounderId\(r(?:,\s*cards)?\)/.test(calls[0]), '/call-notes must use the shared matcher');
  // No inline lookup left behind in either.
  assert.ok(!/LOWER\(name\) = LOWER\(\?\)/.test(calls[0]), '/call-notes must not keep its own inline name lookup');
});

// ── 3. DANNY'S WORDS ARE A DIFFERENT KIND FROM A CALL ──
// kind='note' renders in his ink and means "his read"; kind='granola' is a record of
// a conversation and is what the OBSERVED evidence rung is built on. Collapsing them
// would let Stu quote Danny's opinion as if a founder had said it.
test('/notes writes his read, /call-notes writes a transcript', () => {
  const notes = SRC.match(/router\.post\('\/notes'[\s\S]*?\n\}\);/)[0];
  const calls = SRC.match(/router\.post\('\/call-notes'[\s\S]*?\n\}\);/)[0];
  assert.ok(/ingestNote/.test(notes) && !/ingestGranolaNote/.test(notes));
  assert.ok(/ingestGranolaNote/.test(calls));
});

// ── 4. THE CHANNEL IS OWNER-ONLY AND FAILS CLOSED ──
test('every vault-sync route is behind the secret', () => {
  assert.ok(/router\.use\(requireVaultSyncSecret\)/.test(SRC), 'the secret gate must apply to the whole router');
  assert.ok(
    /if \(!secret\) return res\.status\(503\)/.test(SRC),
    'an unset VAULT_SYNC_SECRET must 503, never fall open'
  );
  assert.ok(/OWNER_ID = 1/.test(SRC));
});

// ── 5. RE-RUNNING IS FREE ──
// recordSource is idempotent on content_hash, so pushing the same dump twice must
// dedupe rather than double every card. The endpoint has to report that honestly —
// "created" and "deduped" are different facts.
test('the notes endpoint distinguishes created from deduped', () => {
  const notes = SRC.match(/router\.post\('\/notes'[\s\S]*?\n\}\);/)[0];
  assert.ok(/out\.created\+\+/.test(notes) && /out\.deduped\+\+/.test(notes),
    'a re-push must be reported as deduped, not counted as new');
});
