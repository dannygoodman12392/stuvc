'use strict';
const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');

// Decision 1: SQLite is canonical. The startup Airtable import must be ADDITIVE-ONLY —
// it may insert new founders and backfill the airtable record id, but must NEVER overwrite
// canonical founder fields (name/company/stage/status/etc.) on existing rows.
test('airtable import never overwrites canonical founder fields', () => {
  const src = fs.readFileSync(path.join(__dirname, '..', 'services', 'airtable-import.js'), 'utf8');
  const updates = src.match(/UPDATE\s+founders\s+SET\s+([^\n]+)/gi) || [];
  for (const u of updates) {
    assert.ok(
      /SET\s+airtable_founder_record_id\s*=/.test(u),
      `airtable-import.js has a founders UPDATE that is not the record-id backfill: ${u}`
    );
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
