/**
 * reset-talent-candidates
 * =======================
 * Full clean slate for Talent: every candidate + match in the DB was sourced under the old
 * engine (fail-open scoring, function mis-typing, no hygiene). Soft-delete them all so the
 * rebuilt engine repopulates from scratch with verified, correctly-typed candidates. Role
 * and company definitions are KEPT (so Hale's CMO etc. survive) — only the stale candidate
 * pool and its matches are cleared. Recoverable (is_deleted flag).
 */
const db = require('../db');

function run() {
  const m = db.prepare("UPDATE talent_matches SET is_deleted = 1 WHERE is_deleted = 0").run().changes;
  const c = db.prepare("UPDATE talent_candidates SET is_deleted = 1 WHERE is_deleted = 0").run().changes;
  console.log(`[reset-talent-candidates] cleared ${c} candidates + ${m} matches (roles/companies kept)`);
}

module.exports = run;
