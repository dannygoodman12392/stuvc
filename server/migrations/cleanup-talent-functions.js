/**
 * cleanup-talent-functions
 * ========================
 * Backfills a function (engineering/gtm/product/...) onto every existing candidate,
 * then removes matches where the candidate's function doesn't fit the role's function
 * (e.g. an engineer matched to a CMO). Runs once on deploy.
 */
const db = require('../db');
const { inferCandidateFunction, normalizeFn } = require('../pipeline/match-engine');

function run() {
  // 1. Type existing candidates
  const cands = db.prepare('SELECT id, current_role, headline, one_liner, tech_stack, role_function FROM talent_candidates WHERE is_deleted = 0').all();
  const upd = db.prepare('UPDATE talent_candidates SET role_function = ? WHERE id = ?');
  let typed = 0;
  const tx1 = db.transaction(() => {
    for (const c of cands) {
      if (c.role_function) continue;
      upd.run(inferCandidateFunction(c), c.id);
      typed++;
    }
  });
  tx1();

  // 2. Remove function-mismatched matches
  const matches = db.prepare(`
    SELECT m.id, r.role_function AS role_fn,
      c.role_function AS cand_fn, c.current_role, c.headline, c.one_liner, c.tech_stack
    FROM talent_matches m
    JOIN talent_roles r ON m.role_id = r.id
    JOIN talent_candidates c ON m.candidate_id = c.id
    WHERE m.is_deleted = 0
  `).all();
  const del = db.prepare('UPDATE talent_matches SET is_deleted = 1, deleted_at = CURRENT_TIMESTAMP WHERE id = ?');
  let removed = 0;
  const tx2 = db.transaction(() => {
    for (const m of matches) {
      const roleFn = normalizeFn(m.role_fn);
      if (roleFn === 'generalist') continue;
      const candFn = m.cand_fn || inferCandidateFunction(m);
      if (candFn !== roleFn) { del.run(m.id); removed++; }
    }
  });
  tx2();

  console.log(`[cleanup-talent-functions] typed ${typed} candidates, removed ${removed} function-mismatched matches`);
}

module.exports = run;
