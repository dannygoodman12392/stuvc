/**
 * cleanup-sourcing-tie
 * ====================
 * Removes founders from the inbox that have no verified Chicago/IL tie. A tie is
 * current residence, working here, an Illinois school, hometown, or a Chicago-HQ
 * employer. Anything else is dismissed (recoverable), per the fund's hard ICP.
 */
const db = require('../db');
const { VALID_TIE_TYPES } = require('../pipeline/sourcing-engine');

function run() {
  const rows = db.prepare("SELECT id, location_type, chicago_connection FROM sourced_founders WHERE status IN ('pending','starred')").all();
  const dismiss = db.prepare("UPDATE sourced_founders SET status = 'dismissed' WHERE id = ?");
  let removed = 0;
  const tx = db.transaction(() => {
    for (const r of rows) {
      const lt = (r.location_type || '').toLowerCase();
      const cc = (r.chicago_connection || '').toLowerCase().trim();
      const hasType = VALID_TIE_TYPES.includes(lt);
      const hasConn = cc && cc !== 'any' && !cc.includes('no verified tie');
      if (!hasType && !hasConn) { dismiss.run(r.id); removed++; }
    }
  });
  tx();
  console.log(`[cleanup-sourcing-tie] dismissed ${removed} founders without a verified Chicago/IL tie`);
}

module.exports = run;
