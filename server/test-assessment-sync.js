#!/usr/bin/env node
/**
 * Manual QA harness for assessment → Notion sync.
 *
 * Usage:
 *   node server/test-assessment-sync.js                      # picks latest complete assessment, syncs founder + assessment
 *   node server/test-assessment-sync.js --id <assessment-id> # sync specific assessment
 *   node server/test-assessment-sync.js --commit             # actually push (default is dry-run preview)
 */
require('dotenv').config({ path: require('path').join(__dirname, '..', '.env'), override: true });

const db = require('./db');

const args = process.argv.slice(2);
function getFlag(name) {
  const i = args.indexOf(`--${name}`);
  if (i === -1) return null;
  return args[i + 1] && !args[i + 1].startsWith('--') ? args[i + 1] : true;
}

const idFlag = getFlag('id');
const commit = getFlag('commit') === true;

(async () => {
  console.log('--- Assessment → Notion sync test ---');
  console.log(`Mode: ${commit ? 'COMMIT' : 'DRY RUN'}`);
  console.log('');

  let assessment;
  if (idFlag) {
    assessment = db.prepare(`
      SELECT a.*, f.name as founder_name, f.company as founder_company
      FROM opportunity_assessments a LEFT JOIN founders f ON a.founder_id = f.id
      WHERE a.id = ? AND a.is_deleted = 0
    `).get(idFlag);
  } else {
    assessment = db.prepare(`
      SELECT a.*, f.name as founder_name, f.company as founder_company
      FROM opportunity_assessments a LEFT JOIN founders f ON a.founder_id = f.id
      WHERE a.is_deleted = 0 AND a.synthesis_output IS NOT NULL AND a.status = 'complete'
      ORDER BY a.created_at DESC LIMIT 1
    `).get();
  }
  if (!assessment) { console.error('✗ No complete assessment found.'); process.exit(1); }

  console.log(`Assessment id=${assessment.id}, version=${assessment.version_number}`);
  console.log(`  Founder:        ${assessment.founder_name} (id ${assessment.founder_id})`);
  console.log(`  Company:        ${assessment.founder_company}`);
  console.log(`  Overall Signal: ${assessment.overall_signal}`);
  console.log(`  Status:         ${assessment.status}`);
  console.log(`  Synthesis len:  ${(assessment.synthesis_output || '').length} chars`);
  console.log('');

  if (!commit) {
    console.log('DRY RUN — re-run with --commit to push.');
    process.exit(0);
  }

  // Step 1: ensure founder is in Notion (sync if not)
  const { findFounderByStuId, pushFounderToNotion } = require('./services/notion-sync');
  let founderPage = await findFounderByStuId(assessment.founder_id);
  if (!founderPage) {
    console.log(`Founder ${assessment.founder_name} not yet in Notion — pushing now...`);
    const founderRow = db.prepare('SELECT * FROM founders WHERE id = ?').get(assessment.founder_id);
    const result = await pushFounderToNotion(founderRow);
    console.log(`  ✓ Founder synced: ${result.url}`);
  } else {
    console.log(`Founder already in Notion: ${founderPage.url}`);
  }
  console.log('');

  // Step 2: push the assessment
  const { pushAssessmentToNotion } = require('./services/notion-assessment-sync');
  console.log('Pushing assessment to Notion...');
  const result = await pushAssessmentToNotion(assessment.id);
  console.log(`✓ ${result.action}. Notion page: ${result.url || result.id}`);
  process.exit(0);
})().catch(err => { console.error('✗ Failed:', err.message); process.exit(1); });
