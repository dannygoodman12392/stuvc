'use strict';
// ══════════════════════════════════════════════════════════════════════════
// One-time: give every pipeline card a stage in Airtable's vocabulary.
//
// The merged board has one stage axis (lib/airtableVocab STAGES). Two populations
// feed it, and only one of them has an Airtable Admission Status:
//
//   161 cards come from Airtable's "Superior Founder Ecosystem" table. The daily
//       sync mirrors their Admission Status into stage_status. Nothing to do here.
//
//    26 cards came from Airtable's SEPARATE "Investment Pipeline" table (their
//       placeholder names still show it — "Avea Robotics (Company)"). They have no
//       Founder Ecosystem record, so Airtable has no Admission Status to give them,
//       and the sync will never touch them. Without this they'd sit stage-less on
//       the merged board forever.
//
// They are not stage-less in truth — the deal table's Status says where each one
// stands, and Airtable's own stage list already has words for both investment-only
// outcomes ("Stage 3: Evaluating (Investment-Only)", "Stage 5: Pass on Investment").
// So this maps the one onto the other, once.
//
// Idempotent: only fills a NULL stage_status, so it can never stomp a stage Danny
// has since dragged. Guarded by migration_flags like every other migration here.
// ══════════════════════════════════════════════════════════════════════════

const db = require('./db');
const { DEAL_STATUS_TO_STAGE, isStage } = require('./lib/airtableVocab');

function backfillStageStatus({ dryRun = false } = {}) {
  const out = { mirrored: 0, derived: 0, unresolved: [], alreadySet: 0 };

  // 1. Airtable-backed rows: stage_status IS the mirror. Cheap to reassert, and it
  //    means a fresh DB is correct before the 5:45am sync has ever run.
  const mirror = db.prepare(`
    SELECT id, airtable_admission_status FROM founders
    WHERE is_deleted = 0 AND stage_status IS NULL AND airtable_admission_status IS NOT NULL
  `).all();
  for (const r of mirror) {
    if (!dryRun) db.prepare('UPDATE founders SET stage_status = ? WHERE id = ?').run(r.airtable_admission_status, r.id);
    out.mirrored++;
  }

  // 2. The Investment-Pipeline orphans: derive from the old deal_status.
  const orphans = db.prepare(`
    SELECT id, name, company, deal_status FROM founders
    WHERE is_deleted = 0 AND stage_status IS NULL
      AND airtable_founder_record_id IS NULL AND pipeline_tracks != ''
  `).all();

  for (const r of orphans) {
    const stage = DEAL_STATUS_TO_STAGE[r.deal_status];
    if (!stage || !isStage(stage)) {
      // No deal_status to reason from. Do NOT guess a stage onto a live card —
      // an invented "Identified" is indistinguishable from a real one once written.
      out.unresolved.push({ id: r.id, company: r.company, deal_status: r.deal_status });
      continue;
    }
    if (!dryRun) db.prepare('UPDATE founders SET stage_status = ? WHERE id = ?').run(stage, r.id);
    out.derived++;
  }

  out.alreadySet = db.prepare(
    'SELECT COUNT(*) n FROM founders WHERE is_deleted = 0 AND stage_status IS NOT NULL'
  ).get().n;
  return out;
}

module.exports = backfillStageStatus;

if (require.main === module) {
  const dryRun = process.argv.includes('--dry');
  const r = backfillStageStatus({ dryRun });
  console.log(`[StageBackfill]${dryRun ? ' (DRY)' : ''} mirrored=${r.mirrored} derived=${r.derived} unresolved=${r.unresolved.length}`);
  for (const u of r.unresolved) console.log(`  ? #${u.id} ${u.company} — deal_status=${JSON.stringify(u.deal_status)}`);
}
