/**
 * QA: Verify that re-syncing from Stu does NOT overwrite Notion-canonical fields
 * (Strider Stage, Conviction Score, Notes once Danny has edited them).
 *
 * This is a critical safety property — sync must be additive, never destructive.
 */
require('dotenv').config({ path: require('path').join(__dirname, '..', '.env'), override: true });

const https = require('https');
const TOKEN = process.env.NOTION_API_KEY;
const NOTION_VERSION = '2022-06-28';

function notion(method, path, body) {
  return new Promise((resolve, reject) => {
    const data = body ? JSON.stringify(body) : null;
    const options = {
      hostname: 'api.notion.com', path, method,
      headers: { 'Authorization': `Bearer ${TOKEN}`, 'Notion-Version': NOTION_VERSION, 'Content-Type': 'application/json' },
    };
    if (data) options.headers['Content-Length'] = Buffer.byteLength(data);
    const req = https.request(options, (res) => {
      let chunks = '';
      res.on('data', c => chunks += c);
      res.on('end', () => res.statusCode < 300 ? resolve(JSON.parse(chunks || '{}')) : reject(new Error(`${res.statusCode}: ${chunks}`)));
    });
    req.on('error', reject);
    if (data) req.write(data);
    req.end();
  });
}

(async () => {
  const pageId = process.argv[2] || '34fc27ba-6a37-81f6-8262-f35ffca4580b';
  const stuId = process.argv[3] || '5481';

  console.log('--- Notion overwrite protection test ---');
  console.log(`Page:    ${pageId}`);
  console.log(`Stu id:  ${stuId}`);
  console.log('');

  console.log('1. Manually edit Notion (simulating Danny\'s post-call work)...');
  await notion('PATCH', `/v1/pages/${pageId}`, {
    properties: {
      'Strider Stage': { select: { name: 'Conviction' } },
      'Conviction Score': { number: 8 },
      'Notes': { rich_text: [{ text: { content: 'MANUAL EDIT: scored 8 after first call. Strong missionary signal.' } }] },
    }
  });
  console.log('   ✓ Set Strider Stage = Conviction, Conviction Score = 8, Notes = manual edit.');

  console.log('2. Re-run Stu → Notion sync...');
  const { pushFounderToNotion } = require('./services/notion-sync');
  const db = require('./db');
  const founder = db.prepare('SELECT * FROM founders WHERE id = ?').get(stuId);
  if (!founder) { console.error(`   ✗ Founder ${stuId} not in Stu DB`); process.exit(1); }
  await pushFounderToNotion(founder);

  console.log('3. Re-fetch Notion record and verify protected fields...');
  const fresh = await notion('GET', `/v1/pages/${pageId}`);
  const stage = fresh.properties['Strider Stage']?.select?.name;
  const score = fresh.properties['Conviction Score']?.number;
  const notes = fresh.properties['Notes']?.rich_text?.[0]?.plain_text;
  console.log(`   Strider Stage:    ${stage}`);
  console.log(`   Conviction Score: ${score}`);
  console.log(`   Notes:            ${notes}`);
  console.log('');

  const ok = stage === 'Conviction' && score === 8 && notes && notes.startsWith('MANUAL EDIT');
  if (ok) {
    console.log('✓ PASS — Notion-canonical fields preserved through Stu sync.');
    process.exit(0);
  } else {
    console.log('✗ FAIL — Stu sync overwrote Notion-canonical fields.');
    process.exit(1);
  }
})().catch(err => { console.error('Error:', err.message); process.exit(1); });
