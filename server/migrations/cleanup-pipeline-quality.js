/**
 * cleanup-pipeline-quality
 * ========================
 * Sweep the current inbox to Danny's bar: dismiss (a) anyone who reads as an investor/VC
 * rather than a founder, and (b) anyone without a verified Chicago/IL tie (valid tie type
 * AND substantiating connection text). Recoverable — sets status='dismissed', not deleted.
 */
const db = require('../db');
const { founderGate, VALID_TIE_TYPES } = require('../pipeline/sourcing-engine');

function run() {
  const rows = db.prepare("SELECT id, name, headline, raw_data, location_type, chicago_connection FROM sourced_founders WHERE status IN ('pending','starred')").all();
  const dismiss = db.prepare("UPDATE sourced_founders SET status = 'dismissed' WHERE id = ?");
  let investors = 0, untied = 0;
  const tx = db.transaction(() => {
    for (const r of rows) {
      let text = '';
      try { text = (JSON.parse(r.raw_data || '{}').text) || ''; } catch {}
      // (a) investor / non-founder
      const gate = founderGate(text, r.headline || '');
      if (!gate.ok) { dismiss.run(r.id); investors++; continue; }
      // (b) verified Chicago/IL tie required
      const lt = (r.location_type || '').toLowerCase();
      const cc = (r.chicago_connection || '').toLowerCase().trim();
      const hasTie = VALID_TIE_TYPES.includes(lt) && cc && cc !== 'any' && !cc.includes('no verified tie');
      if (!hasTie) { dismiss.run(r.id); untied++; }
    }
  });
  tx();
  console.log(`[cleanup-pipeline-quality] dismissed ${investors} investor/non-founder + ${untied} untied (of ${rows.length} reviewed)`);
}

module.exports = run;
