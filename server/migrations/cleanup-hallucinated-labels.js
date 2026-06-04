/**
 * cleanup-hallucinated-labels
 * ===========================
 * Re-verify every pending/starred founder's school + pedigree labels against their OWN
 * profile text using the strict verifier. Strip any label not genuinely in the text
 * (the hallucinated "MIT / Illinois Institute of Technology" case). If a founder's only
 * Chicago/IL tie was being an IL-school alum and that school doesn't verify, the tie is
 * fake — dismiss them.
 */
const db = require('../db');
const { verifyPedigree } = require('../pipeline/sourcing-engine');

function parseArr(s) { try { const v = JSON.parse(s || '[]'); return Array.isArray(v) ? v : []; } catch { return []; } }

function run() {
  const rows = db.prepare("SELECT id, headline, raw_data, location_type, pedigree_signals, anchor_schools_il, elite_schools_national FROM sourced_founders WHERE status IN ('pending','starred')").all();
  const upd = db.prepare("UPDATE sourced_founders SET pedigree_signals = ?, anchor_schools_il = ?, elite_schools_national = ? WHERE id = ?");
  const dismiss = db.prepare("UPDATE sourced_founders SET status = 'dismissed' WHERE id = ?");
  let scrubbed = 0, dismissed = 0;
  const tx = db.transaction(() => {
    for (const r of rows) {
      let text = '';
      try { text = (JSON.parse(r.raw_data || '{}').text) || ''; } catch {}
      const verifyText = (r.headline || '') + ' ' + text;
      const ped = verifyPedigree(parseArr(r.pedigree_signals), verifyText);
      const anchor = verifyPedigree(parseArr(r.anchor_schools_il), verifyText);
      const elite = verifyPedigree(parseArr(r.elite_schools_national), verifyText);
      const before = parseArr(r.pedigree_signals).length + parseArr(r.anchor_schools_il).length + parseArr(r.elite_schools_national).length;
      const after = ped.length + anchor.length + elite.length;
      if (after < before) { upd.run(JSON.stringify(ped), JSON.stringify(anchor), JSON.stringify(elite), r.id); scrubbed++; }
      // School-only tie that no longer verifies → fake tie → dismiss.
      if (r.location_type === 'school_alumni' && anchor.length === 0) { dismiss.run(r.id); dismissed++; }
    }
  });
  tx();
  console.log(`[cleanup-hallucinated-labels] scrubbed labels on ${scrubbed} founders, dismissed ${dismissed} with unverified school-ties (of ${rows.length})`);
}

module.exports = run;
