/**
 * One-way Stu → Airtable push service
 *
 * Fires async after stage changes in Stu. Non-blocking — errors are logged
 * but never break the Stu update flow.
 */

const https = require('https');
const db = require('../db');
const { stuAdmissionsToAirtable, stuDealToAirtable } = require('./stage-mapping');

const AIRTABLE_API_KEY = process.env.AIRTABLE_API_KEY;
const BASE_ID = 'appfE9DVrSUOrkkpu';
const FOUNDER_TABLE = 'tblWkJzy5qpw7FP2M';
const DEAL_TABLE = 'tblCWTVyowHgp4YuR';

function patchAirtableRecord(tableId, recordId, fields) {
  return new Promise((resolve, reject) => {
    const data = JSON.stringify({ fields });
    const url = new URL(`https://api.airtable.com/v0/${BASE_ID}/${tableId}/${recordId}`);

    const req = https.request({
      hostname: url.hostname,
      path: url.pathname,
      method: 'PATCH',
      headers: {
        'Authorization': `Bearer ${AIRTABLE_API_KEY}`,
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(data),
      },
    }, (res) => {
      let body = '';
      res.on('data', chunk => body += chunk);
      res.on('end', () => {
        if (res.statusCode >= 200 && res.statusCode < 300) {
          resolve(JSON.parse(body));
        } else {
          reject(new Error(`Airtable ${res.statusCode}: ${body}`));
        }
      });
    });

    req.on('error', reject);
    req.write(data);
    req.end();
  });
}

function logSync(founderId, tableName, fieldName, oldValue, newValue, recordId, status, errorMessage) {
  try {
    db.prepare(`
      INSERT INTO airtable_sync_log (founder_id, table_name, field_name, old_value, new_value, airtable_record_id, status, error_message)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `).run(founderId, tableName, fieldName, oldValue, newValue, recordId, status, errorMessage);
  } catch (err) {
    console.error('[AirtableSync] Failed to write sync log:', err.message);
  }
}

/**
 * Push admissions_status change to Airtable Founder Ecosystem table
 */
async function pushAdmissionsChange(founder, oldStatus) {
  const recordId = founder.airtable_founder_record_id;
  if (!recordId) {
    console.warn(`[AirtableSync] No Airtable record ID for founder ${founder.id} (${founder.name}), skipping admissions push`);
    return;
  }

  const hasInvestment = (founder.pipeline_tracks || '').includes('investment');
  const airtableValue = stuAdmissionsToAirtable(founder.admissions_status, hasInvestment);

  if (!airtableValue) {
    console.warn(`[AirtableSync] No Airtable mapping for admissions_status="${founder.admissions_status}", skipping`);
    return;
  }

  console.log(`[AirtableSync] Pushing admissions change: ${founder.name} → ${airtableValue}`);

  try {
    await patchAirtableRecord(FOUNDER_TABLE, recordId, {
      'Admission Status': airtableValue,
    });
    logSync(founder.id, 'founder_ecosystem', 'Admission Status', oldStatus, founder.admissions_status, recordId, 'success', null);
    console.log(`[AirtableSync] ✓ ${founder.name} admissions pushed to Airtable`);
  } catch (err) {
    logSync(founder.id, 'founder_ecosystem', 'Admission Status', oldStatus, founder.admissions_status, recordId, 'failed', err.message);
    console.error(`[AirtableSync] ✗ ${founder.name} admissions push failed:`, err.message);
  }
}

/**
 * Push deal_status change to Airtable Investment Pipeline table
 */
async function pushDealChange(founder, oldStatus) {
  const recordId = founder.airtable_deal_record_id;
  if (!recordId) {
    console.warn(`[AirtableSync] No Airtable deal record ID for founder ${founder.id} (${founder.name}), skipping deal push`);
    return;
  }

  const airtableValue = stuDealToAirtable(founder.deal_status);

  if (!airtableValue) {
    console.warn(`[AirtableSync] No Airtable mapping for deal_status="${founder.deal_status}", skipping`);
    return;
  }

  console.log(`[AirtableSync] Pushing deal change: ${founder.name} → ${airtableValue}`);

  try {
    await patchAirtableRecord(DEAL_TABLE, recordId, {
      'Status': airtableValue,
    });
    logSync(founder.id, 'investment_pipeline', 'Status', oldStatus, founder.deal_status, recordId, 'success', null);
    console.log(`[AirtableSync] ✓ ${founder.name} deal pushed to Airtable`);
  } catch (err) {
    logSync(founder.id, 'investment_pipeline', 'Status', oldStatus, founder.deal_status, recordId, 'failed', err.message);
    console.error(`[AirtableSync] ✗ ${founder.name} deal push failed:`, err.message);
  }
}

module.exports = { pushAdmissionsChange, pushDealChange };
