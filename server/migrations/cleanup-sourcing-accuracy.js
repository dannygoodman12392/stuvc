/**
 * cleanup-sourcing-accuracy
 * =========================
 * Re-verifies pedigree tags on existing inbox founders against their stored profile
 * text and drops any that aren't actually supported (e.g. a loose "Ex-Meta" or "MIT"
 * tag from old substring matching). Conservative: only removes unsupported tags.
 */
const db = require('../db');
const { verifyPedigree } = require('../pipeline/sourcing-engine');

function safeParse(v, f) { try { const x = JSON.parse(v || 'null'); return x == null ? f : x; } catch { return f; } }

function run() {
  const rows = db.prepare("SELECT id, raw_data, headline, pedigree_signals FROM sourced_founders WHERE status IN ('pending','starred')").all();
  const upd = db.prepare('UPDATE sourced_founders SET pedigree_signals = ? WHERE id = ?');
  let cleaned = 0, removedTags = 0;
  const tx = db.transaction(() => {
    for (const r of rows) {
      const raw = safeParse(r.raw_data, {});
      const text = (r.headline || raw.headline || '') + ' ' + (raw.text || '');
      const existing = safeParse(r.pedigree_signals, []);
      if (!Array.isArray(existing) || existing.length === 0) continue;
      const verified = verifyPedigree(existing, text);
      if (verified.length !== existing.length) {
        upd.run(JSON.stringify(verified), r.id);
        cleaned++;
        removedTags += existing.length - verified.length;
      }
    }
  });
  tx();
  console.log(`[cleanup-sourcing-accuracy] removed ${removedTags} unsupported pedigree tags across ${cleaned} founders`);
}

module.exports = run;
