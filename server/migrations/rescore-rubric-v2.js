/**
 * rescore-rubric-v2.js
 * One-time migration: re-run all existing assessments with updated rubric.
 * Creates new versions (preserves originals), copies inputs, runs agents.
 * Called from index.js behind migration flag 'rescore_rubric_v2'.
 */

const crypto = require('crypto');
const db = require('../db');

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

async function run() {
  // Get the internal runner from assessments route
  const assessmentsRouter = require('../routes/assessments');
  const { runAssessmentAgents } = assessmentsRouter._internal;

  if (!runAssessmentAgents) {
    console.error('[Rescore] Could not access runAssessmentAgents — skipping');
    return;
  }

  const assessments = db.prepare(`
    SELECT oa.*, f.name as founder_name, f.company as founder_company
    FROM opportunity_assessments oa
    LEFT JOIN founders f ON oa.founder_id = f.id
    WHERE oa.is_deleted = 0
      AND oa.status IN ('complete', 'partial')
    ORDER BY oa.created_at ASC
  `).all();

  if (assessments.length === 0) {
    console.log('[Rescore] No assessments to rescore.');
    return;
  }

  console.log(`[Rescore] Rescoring ${assessments.length} assessments with rubric v2...`);

  const insertInput = db.prepare('INSERT INTO assessment_inputs (assessment_id, input_type, label, content, source_url, file_name, mime_type) VALUES (?, ?, ?, ?, ?, ?, ?)');

  for (let i = 0; i < assessments.length; i++) {
    const assessment = assessments[i];
    const label = `${assessment.founder_name || 'Unknown'} (${assessment.founder_company || ''})`;

    try {
      const gid = assessment.group_id || crypto.randomUUID();
      const versionNumber = (assessment.version_number || 1) + 1;

      // Create new assessment
      const result = db.prepare(`
        INSERT INTO opportunity_assessments (founder_id, inputs, status, group_id, version_number, created_by)
        VALUES (?, '{}', 'running', ?, ?, ?)
      `).run(assessment.founder_id, gid, versionNumber, assessment.created_by);
      const newId = result.lastInsertRowid;

      // Ensure original has group_id
      if (!assessment.group_id) {
        db.prepare('UPDATE opportunity_assessments SET group_id = ? WHERE id = ?').run(gid, assessment.id);
        db.prepare('INSERT OR IGNORE INTO assessment_versions (group_id, assessment_id, version_number, change_summary) VALUES (?, ?, 1, ?)').run(gid, assessment.id, 'v1: Original assessment');
      }

      db.prepare('INSERT INTO assessment_versions (group_id, assessment_id, version_number, change_summary, previous_assessment_id) VALUES (?, ?, ?, ?, ?)').run(
        gid, newId, versionNumber, `v${versionNumber}: Rubric v2 rescore`, assessment.id
      );

      // Copy inputs
      const oldInputs = db.prepare('SELECT * FROM assessment_inputs WHERE assessment_id = ?').all(assessment.id);
      for (const inp of oldInputs) {
        insertInput.run(newId, inp.input_type, inp.label, inp.content, inp.source_url, inp.file_name, inp.mime_type);
      }

      console.log(`[Rescore] [${i + 1}/${assessments.length}] ${label} → #${newId} (${oldInputs.length} inputs)`);

      // Run agents
      await runAssessmentAgents(newId, assessment.founder_id);

      const updated = db.prepare('SELECT overall_signal, synthesis_output FROM opportunity_assessments WHERE id = ?').get(newId);
      let score = '?';
      try {
        const syn = JSON.parse(updated.synthesis_output);
        score = syn.overall_score;
      } catch {}
      console.log(`[Rescore] [${i + 1}/${assessments.length}] ${label} → ${score} (${updated.overall_signal})`);

      // Rate limit pause between companies
      if (i < assessments.length - 1) await sleep(3000);

    } catch (err) {
      console.error(`[Rescore] Failed ${label}:`, err.message);
    }
  }

  console.log('[Rescore] Rubric v2 rescore complete.');
}

module.exports = run;
