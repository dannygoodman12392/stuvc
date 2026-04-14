/**
 * rescore-rubric-v3.js
 * Fixes the v2 rescore migration. v2 rescored ALL versions (30 total),
 * creating duplicate versions with lower version_numbers than existing ones.
 *
 * This migration:
 * 1. Soft-deletes all the junk assessments created by v2
 * 2. For each unique group, finds the latest ORIGINAL version (pre-v2)
 * 3. Creates ONE new version with version_number = max + 1
 * 4. Copies inputs from the latest original, runs agents
 */

const crypto = require('crypto');
const db = require('../db');

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

async function run() {
  const assessmentsRouter = require('../routes/assessments');
  const { runAssessmentAgents } = assessmentsRouter._internal;

  if (!runAssessmentAgents) {
    console.error('[Rescore-v3] Could not access runAssessmentAgents — skipping');
    return;
  }

  // Step 1: Soft-delete all assessments created by the v2 migration
  // These were created on 2026-04-14 02:10+ and have change_summary containing "Rubric v2"
  const v2Junk = db.prepare(`
    SELECT a.id FROM opportunity_assessments a
    INNER JOIN assessment_versions av ON av.assessment_id = a.id
    WHERE av.change_summary LIKE '%Rubric v2%'
      AND a.is_deleted = 0
  `).all();

  if (v2Junk.length > 0) {
    console.log(`[Rescore-v3] Cleaning up ${v2Junk.length} junk assessments from v2 migration...`);
    const deleteStmt = db.prepare('UPDATE opportunity_assessments SET is_deleted = 1 WHERE id = ?');
    for (const row of v2Junk) {
      deleteStmt.run(row.id);
    }
  }

  // Step 2: Find the latest version per group (non-deleted, complete)
  const latestPerGroup = db.prepare(`
    SELECT a.*, f.name as founder_name, f.company as founder_company,
           (SELECT MAX(a2.version_number) FROM opportunity_assessments a2
            WHERE a2.group_id = a.group_id AND a2.is_deleted = 0) as max_version
    FROM opportunity_assessments a
    LEFT JOIN founders f ON a.founder_id = f.id
    WHERE a.is_deleted = 0
      AND a.status IN ('complete', 'partial')
      AND a.group_id IS NOT NULL
      AND a.id = (
        SELECT a3.id FROM opportunity_assessments a3
        WHERE a3.group_id = a.group_id AND a3.is_deleted = 0
        ORDER BY a3.version_number DESC, a3.created_at DESC
        LIMIT 1
      )
    ORDER BY a.created_at ASC
  `).all();

  // Also include ungrouped assessments
  const ungrouped = db.prepare(`
    SELECT a.*, f.name as founder_name, f.company as founder_company,
           a.version_number as max_version
    FROM opportunity_assessments a
    LEFT JOIN founders f ON a.founder_id = f.id
    WHERE a.is_deleted = 0
      AND a.status IN ('complete', 'partial')
      AND a.group_id IS NULL
    ORDER BY a.created_at ASC
  `).all();

  const toRescore = [...latestPerGroup, ...ungrouped];

  if (toRescore.length === 0) {
    console.log('[Rescore-v3] No assessments to rescore.');
    return;
  }

  console.log(`[Rescore-v3] Rescoring ${toRescore.length} assessments (latest version per group only)...`);

  const insertInput = db.prepare('INSERT INTO assessment_inputs (assessment_id, input_type, label, content, source_url, file_name, mime_type) VALUES (?, ?, ?, ?, ?, ?, ?)');

  for (let i = 0; i < toRescore.length; i++) {
    const assessment = toRescore[i];
    const label = `${assessment.founder_name || 'Unknown'} (${assessment.founder_company || ''})`;

    try {
      const gid = assessment.group_id || crypto.randomUUID();
      const newVersion = (assessment.max_version || assessment.version_number || 1) + 1;

      const result = db.prepare(`
        INSERT INTO opportunity_assessments (founder_id, inputs, status, group_id, version_number, created_by)
        VALUES (?, '{}', 'running', ?, ?, ?)
      `).run(assessment.founder_id, gid, newVersion, assessment.created_by);
      const newId = result.lastInsertRowid;

      if (!assessment.group_id) {
        db.prepare('UPDATE opportunity_assessments SET group_id = ? WHERE id = ?').run(gid, assessment.id);
      }

      db.prepare('INSERT INTO assessment_versions (group_id, assessment_id, version_number, change_summary, previous_assessment_id) VALUES (?, ?, ?, ?, ?)').run(
        gid, newId, newVersion, `v${newVersion}: Rubric v3 rescore (calibrated)`, assessment.id
      );

      // Copy inputs from the source assessment
      const sourceInputs = db.prepare('SELECT * FROM assessment_inputs WHERE assessment_id = ?').all(assessment.id);

      // If source has no inputs, try to find inputs from any version in the group
      let inputsToCopy = sourceInputs;
      if (inputsToCopy.length === 0 && assessment.group_id) {
        const anyVersion = db.prepare(`
          SELECT ai.* FROM assessment_inputs ai
          INNER JOIN opportunity_assessments oa ON ai.assessment_id = oa.id
          WHERE oa.group_id = ? AND oa.is_deleted = 0
          ORDER BY oa.version_number DESC
          LIMIT 100
        `).all(assessment.group_id);

        // Deduplicate by content hash
        const seen = new Set();
        inputsToCopy = anyVersion.filter(inp => {
          const key = `${inp.input_type}:${inp.label}:${(inp.content || '').slice(0, 100)}`;
          if (seen.has(key)) return false;
          seen.add(key);
          return true;
        });
      }

      for (const inp of inputsToCopy) {
        insertInput.run(newId, inp.input_type, inp.label, inp.content, inp.source_url, inp.file_name, inp.mime_type);
      }

      console.log(`[Rescore-v3] [${i + 1}/${toRescore.length}] ${label} → #${newId} v${newVersion} (${inputsToCopy.length} inputs)`);

      await runAssessmentAgents(newId, assessment.founder_id);

      const updated = db.prepare('SELECT overall_signal, synthesis_output FROM opportunity_assessments WHERE id = ?').get(newId);
      let score = '?';
      try {
        const syn = JSON.parse(updated.synthesis_output);
        score = syn.overall_score;
      } catch {}
      console.log(`[Rescore-v3] [${i + 1}/${toRescore.length}] ${label} → ${score} (${updated.overall_signal})`);

      if (i < toRescore.length - 1) await sleep(3000);

    } catch (err) {
      console.error(`[Rescore-v3] Failed ${label}:`, err.message);
    }
  }

  console.log('[Rescore-v3] Rubric v3 rescore complete.');
}

module.exports = run;
