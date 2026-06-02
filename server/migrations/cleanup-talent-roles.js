/**
 * cleanup-talent-roles
 * ====================
 * Derives each role's true function from its title/JD (e.g. "CMO" → gtm), persists it,
 * then removes matches where the candidate's function doesn't fit the role's resolved
 * function. Fixes roles that were silently stuck on the 'engineering' default.
 */
const db = require('../db');
const { resolveRoleFunction, inferCandidateFunction } = require('../pipeline/match-engine');

function run() {
  // 1. Resolve + persist role functions from title/JD
  const roles = db.prepare('SELECT id, title, jd_content, role_function FROM talent_roles WHERE is_deleted = 0').all();
  const updRole = db.prepare('UPDATE talent_roles SET role_function = ? WHERE id = ?');
  const roleFn = {};
  let retyped = 0;
  const tx1 = db.transaction(() => {
    for (const r of roles) {
      const resolved = resolveRoleFunction(r);
      roleFn[r.id] = resolved;
      if (resolved !== r.role_function) { updRole.run(resolved, r.id); retyped++; }
    }
  });
  tx1();

  // 2. Purge function-mismatched matches using the resolved role functions
  const matches = db.prepare(`
    SELECT m.id, m.role_id,
      c.role_function AS cand_fn, c.current_role, c.headline, c.one_liner, c.tech_stack
    FROM talent_matches m
    JOIN talent_candidates c ON m.candidate_id = c.id
    WHERE m.is_deleted = 0
  `).all();
  const del = db.prepare('UPDATE talent_matches SET is_deleted = 1, deleted_at = CURRENT_TIMESTAMP WHERE id = ?');
  let removed = 0;
  const tx2 = db.transaction(() => {
    for (const m of matches) {
      const rfn = roleFn[m.role_id];
      if (!rfn || rfn === 'generalist') continue;
      const candFn = m.cand_fn || inferCandidateFunction(m);
      if (candFn !== rfn) { del.run(m.id); removed++; }
    }
  });
  tx2();

  console.log(`[cleanup-talent-roles] retyped ${retyped} roles, removed ${removed} mismatched matches`);
}

module.exports = run;
