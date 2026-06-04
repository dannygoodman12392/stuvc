/**
 * cleanup-unverified-sourced
 * ==========================
 * During an Anthropic credit outage the engine admitted founders without successful AI
 * verification — falling back to crude keyword scoring, which let non-founders with false
 * ties through (e.g. Mark Suster, an LA VC, tagged S-tier / Chicago). Those rows carry a
 * tell-tale confidence_rationale. Dismiss every pending/starred sourced founder that was
 * never actually verified, so the inbox only contains AI-verified builders.
 */
const db = require('../db');

const UNVERIFIED = ['Scoring failed', 'scoring unavailable', 'AI scoring unavailable', 'Could not parse', 'Not assessed', 'credit balance'];

function run() {
  const rows = db.prepare("SELECT id, name, confidence_rationale FROM sourced_founders WHERE status IN ('pending','starred')").all();
  const dismiss = db.prepare("UPDATE sourced_founders SET status = 'dismissed' WHERE id = ?");
  let removed = 0;
  const tx = db.transaction(() => {
    for (const r of rows) {
      const rat = (r.confidence_rationale || '');
      if (UNVERIFIED.some(s => rat.includes(s))) { dismiss.run(r.id); removed++; }
    }
  });
  tx();
  console.log(`[cleanup-unverified-sourced] dismissed ${removed} unverified founders (admitted without AI verification)`);
}

module.exports = run;
