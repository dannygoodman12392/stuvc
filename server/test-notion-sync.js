#!/usr/bin/env node
/**
 * Manual QA harness for Stu → Notion sync.
 *
 * Usage:
 *   node server/test-notion-sync.js                           # picks 1 investment-track founder, dry-runs
 *   node server/test-notion-sync.js --id <stu-founder-id>     # sync a specific founder
 *   node server/test-notion-sync.js --commit                  # actually call Notion (default is dry run)
 *   node server/test-notion-sync.js --query <stu-id>          # query Notion for an existing record by SS Record ID
 *   node server/test-notion-sync.js --health                  # verify NOTION_API_KEY + DB ID are valid (no writes)
 */

require('dotenv').config({ path: require('path').join(__dirname, '..', '.env'), override: true });

const db = require('./db');
const { pushFounderToNotion, findFounderByStuId } = require('./services/notion-sync');

const args = process.argv.slice(2);
function getFlag(name) {
  const i = args.indexOf(`--${name}`);
  if (i === -1) return null;
  return args[i + 1] && !args[i + 1].startsWith('--') ? args[i + 1] : true;
}

const idFlag = getFlag('id');
const commit = getFlag('commit') === true;
const queryId = getFlag('query');
const health = getFlag('health') === true;

async function main() {
  console.log('--- Stu → Notion sync test ---');
  console.log(`NOTION_API_KEY:        ${process.env.NOTION_API_KEY ? '✓ set (' + process.env.NOTION_API_KEY.slice(0, 8) + '...)' : '✗ MISSING'}`);
  console.log(`NOTION_FOUNDERS_DB_ID: ${process.env.NOTION_FOUNDERS_DB_ID || '✗ MISSING'}`);
  console.log(`Mode:                  ${commit ? 'COMMIT (writes to Notion)' : 'DRY RUN (no writes)'}`);
  console.log('');

  if (health) {
    console.log('Health check: querying Notion for a non-existent SS Record ID...');
    try {
      const result = await findFounderByStuId('__health_check_nonexistent__');
      console.log(`✓ Notion API reachable. (Result: ${result ? 'unexpected hit' : 'no match — expected'})`);
      process.exit(0);
    } catch (err) {
      console.error('✗ Notion API failed:', err.message);
      console.error('  → Check NOTION_API_KEY is valid and the integration has access to the Founders DB.');
      process.exit(1);
    }
  }

  if (queryId) {
    console.log(`Querying Notion for SS Record ID = ${queryId}...`);
    try {
      const found = await findFounderByStuId(queryId);
      if (found) {
        console.log(`✓ Found Notion page: ${found.url || found.id}`);
        const props = found.properties || {};
        const title = props['Name']?.title?.[0]?.plain_text;
        const company = props['Company']?.rich_text?.[0]?.plain_text;
        const stage = props['Strider Stage']?.select?.name;
        console.log(`  Name:          ${title}`);
        console.log(`  Company:       ${company}`);
        console.log(`  Strider Stage: ${stage}`);
      } else {
        console.log(`(no record with SS Record ID = ${queryId})`);
      }
      process.exit(0);
    } catch (err) {
      console.error('✗ Query failed:', err.message);
      process.exit(1);
    }
  }

  // Pick a founder
  let founder;
  if (idFlag) {
    founder = db.prepare('SELECT * FROM founders WHERE id = ? AND is_deleted = 0').get(idFlag);
    if (!founder) {
      console.error(`✗ Founder ${idFlag} not found (or soft-deleted)`);
      process.exit(1);
    }
  } else {
    founder = db.prepare("SELECT * FROM founders WHERE is_deleted = 0 AND pipeline_tracks LIKE '%investment%' ORDER BY created_at DESC LIMIT 1").get();
    if (!founder) {
      console.error('✗ No investment-track founders found in DB. Pass --id <id> to sync a specific founder.');
      process.exit(1);
    }
  }

  console.log(`Founder: ${founder.name} (Stu id=${founder.id})`);
  console.log(`  Company:       ${founder.company || '(none)'}`);
  console.log(`  Stage:         ${founder.stage || '(none)'}`);
  console.log(`  Tracks:        ${founder.pipeline_tracks || '(none)'}`);
  console.log(`  Fit score:     ${founder.fit_score || '(none)'}`);
  console.log(`  Domain:        ${founder.domain || '(none)'}`);
  console.log(`  Source:        ${founder.source || '(none)'}`);
  console.log('');

  if (!commit) {
    console.log('DRY RUN — would query Notion by SS Record ID and create/update.');
    console.log('Re-run with --commit to actually push to Notion.');
    process.exit(0);
  }

  console.log('Pushing to Notion...');
  try {
    const result = await pushFounderToNotion(founder);
    if (result && result.url) {
      console.log(`✓ Done. Notion page: ${result.url}`);
    } else if (result && result.id) {
      console.log(`✓ Done. Notion page id: ${result.id}`);
    } else {
      console.log('✓ Done (no page returned — may have skipped due to missing required fields).');
    }
    process.exit(0);
  } catch (err) {
    console.error('✗ Push failed:', err.message);
    process.exit(1);
  }
}

main();
