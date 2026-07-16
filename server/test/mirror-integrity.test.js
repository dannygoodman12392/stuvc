'use strict';
const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');

// ══════════════════════════════════════════════════════════════════════════
// Decision 1, NARROWED (2026-07-16). It used to read:
//
//   "SQLite is canonical. The startup Airtable import must be ADDITIVE-ONLY — it
//    may insert new founders and backfill the airtable record id, but must NEVER
//    overwrite canonical founder fields (name/company/stage/status/etc.)."
//
// and this test enforced it by banning every founders UPDATE except the record-id
// backfill. The rule was too broad, and it cost four months of accuracy.
//
// SQLite IS canonical for what Stu PRODUCES: conviction scores, assessments,
// sources, signals, notes, deal_status. Airtable has no opinion about those and
// must never touch them. That half of Decision 1 stands, and is enforced below.
//
// But SQLite was never canonical for what Danny AUTHORS ELSEWHERE. He maintains
// the admissions funnel by hand in Airtable — it's the team's CRM, they read it,
// and he'd been updating stages there all along ("You can see how I added stages
// for each in Airtable already"). Under the old rule those edits were fetched
// every morning at 5:45 and thrown away. Measured 2026-07-16: 49 of 159 founders
// (31%) disagreed with Airtable, including 22 Danny had already declined that
// Stu still showed as live prospects, and 4 admitted residents shown as unclosed.
//
// So the invariant is no longer "never UPDATE". It's "only ever UPDATE columns
// Airtable authors" — which is a real fence, and this is where it's nailed down.
// ══════════════════════════════════════════════════════════════════════════
test('airtable import only writes columns Airtable authors', () => {
  const { AUTHORITATIVE, FILL_IF_EMPTY } = require('../services/airtable-import').__test;

  // Everything the import is permitted to touch on an existing row.
  const WRITABLE = new Set([
    ...AUTHORITATIVE, ...FILL_IF_EMPTY,
    'pipeline_tracks',              // unioned, never replaced — see mergeTracks()
    'airtable_founder_record_id',   // the backfill
    'airtable_synced_at',           // bookkeeping
  ]);

  // Stu's own work. If the import can write any of these, the fence is broken.
  const STU_OWNED = [
    'conviction_score', 'conviction_band', 'deal_status', 'caliber_tier',
    'caliber_score', 'caliber_signals', 'evidence_map', 'red_flags',
    'investment_amount', 'valuation', 'round_size', 'security_type',
    'memo_status', 'diligence_status', 'pass_reason', 'is_deleted',
  ];
  for (const col of STU_OWNED) {
    assert.ok(!WRITABLE.has(col),
      `airtable-import may not write "${col}" — that is Stu's, not Airtable's`);
  }

  // `name` is the match key. Rewriting it would let one Airtable typo detach a
  // founder from every assessment, source and signal hanging off their row.
  assert.ok(!WRITABLE.has('name'), 'the import must never rewrite founders.name — it is the match key');

  // And no raw UPDATE may smuggle in a column outside the allowlist. The single
  // permitted UPDATE builds its SET clause from the diff list, so the allowlist
  // above IS the fence; this catches anyone adding a second, hand-rolled one.
  const src = fs.readFileSync(path.join(__dirname, '..', 'services', 'airtable-import.js'), 'utf8');
  const updates = src.match(/UPDATE\s+founders\s+SET\s+([^\n]+)/gi) || [];
  for (const u of updates) {
    const isBuiltFromDiffs = /\$\{setSql\}/.test(u);
    const isRecordIdBackfill = /SET\s+airtable_founder_record_id\s*=/.test(u);
    assert.ok(isBuiltFromDiffs || isRecordIdBackfill,
      `hand-rolled founders UPDATE in airtable-import.js bypasses the ownership allowlist: ${u}`);
  }
});

// Notion sync exports the drift-check used for mirror integrity.
test('notion-sync exposes checkNotionDrift', () => {
  const ns = require('../services/notion-sync');
  assert.strictEqual(typeof ns.checkNotionDrift, 'function');
});

// Drift check is safe when Notion isn't configured (no throw, reports not-configured).
test('checkNotionDrift no-ops cleanly without Notion config', async () => {
  const ns = require('../services/notion-sync');
  // In test env NOTION creds are absent → configured:false, no network.
  const r = await ns.checkNotionDrift(1);
  assert.strictEqual(r.configured, false);
});
