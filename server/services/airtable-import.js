/**
 * Incremental Airtable → Stu sync
 *
 * Fetches all founders from Airtable's "Superior Founder Ecosystem" table
 * and upserts any that don't already exist in Stu (matched by airtable_founder_record_id
 * or name+company). Existing founders are NOT overwritten.
 *
 * Safe to run repeatedly — only inserts new records.
 */

const db = require('../db');
const https = require('https');

const AIRTABLE_API_KEY = process.env.AIRTABLE_API_KEY;
const BASE_ID = 'appfE9DVrSUOrkkpu';
const FOUNDER_TABLE = 'tblWkJzy5qpw7FP2M';

function fetchAirtable(tableId) {
  return new Promise((resolve, reject) => {
    const records = [];
    function fetchPage(offset) {
      let url = `https://api.airtable.com/v0/${BASE_ID}/${tableId}?pageSize=100`;
      if (offset) url += `&offset=${offset}`;
      const req = https.get(url, { headers: { 'Authorization': `Bearer ${AIRTABLE_API_KEY}` } }, (res) => {
        let body = '';
        res.on('data', chunk => body += chunk);
        res.on('end', () => {
          try {
            const data = JSON.parse(body);
            records.push(...(data.records || []));
            if (data.offset) fetchPage(data.offset);
            else resolve(records);
          } catch (e) { reject(e); }
        });
      });
      req.on('error', reject);
    }
    fetchPage(null);
  });
}

function mapNextStepToAdmissions(nextStep) {
  if (!nextStep) return 'Sourced';
  const ns = nextStep.toLowerCase().trim();
  if (ns === 'hold') return 'Hold/Nurture';
  if (ns === 'admitted') return 'Admitted';
  if (ns === 'met') return 'First Call Complete';
  if (ns === 'convert to ssfi applicant') return 'Sourced';
  if (ns === 'support action items') return 'Hold/Nurture';
  if (ns.includes('scheduling 1st') || ns.includes('1st mtg scheduling')) return 'Outreach';
  if (ns.includes('1st mtg scheduled')) return 'First Call Scheduled';
  if (ns.includes('scheduling 2nd') || ns.includes('2nd mtg scheduling')) return 'First Call Complete';
  if (ns.includes('2nd mtg scheduled')) return 'Second Call Scheduled';
  if (ns.includes('scheduling 3rd') || ns.includes('3rd mtg')) return 'Second Call Complete';
  return 'Sourced';
}

function mapAdmissionStatus(airtableStatus, nextStep) {
  if (!airtableStatus) return { admissions_status: 'Sourced', status: 'Sourced' };
  const s = airtableStatus.trim().toLowerCase();

  if (s.includes('stage 0') || s.includes('legacy (density)') || s.includes('legacy density')) {
    return { admissions_status: 'Density Resident', status: 'Active' };
  }
  if (s.includes('stage 1')) {
    const admStatus = mapNextStepToAdmissions(nextStep);
    let overallStatus = 'Sourced';
    if (['Outreach', 'First Call Scheduled'].includes(admStatus)) overallStatus = 'Outreach';
    if (['First Call Complete', 'Second Call Scheduled', 'Second Call Complete'].includes(admStatus)) overallStatus = 'Interviewing';
    if (admStatus === 'Hold/Nurture') overallStatus = 'Hold';
    return { admissions_status: admStatus, status: overallStatus };
  }
  if (s.includes('stage 2')) {
    const admStatus = mapNextStepToAdmissions(nextStep);
    let mapped = admStatus === 'Sourced' ? 'First Call Complete' : admStatus;
    return { admissions_status: mapped, status: 'Interviewing' };
  }
  if (s.includes('stage 3')) {
    const admStatus = mapNextStepToAdmissions(nextStep);
    let mapped = admStatus === 'Sourced' ? 'Second Call Scheduled' : admStatus;
    return { admissions_status: mapped, status: 'Interviewing' };
  }
  if (s.includes('stage 4')) {
    if (s.includes('admitted')) return { admissions_status: 'Active Resident', status: 'Active' };
    const admStatus = mapNextStepToAdmissions(nextStep);
    let mapped = admStatus === 'Sourced' ? 'Second Call Complete' : admStatus;
    return { admissions_status: mapped, status: 'Interviewing' };
  }
  if (s.includes('stage 5')) {
    if (s.includes('legacy density') || s.includes('legacy (density)')) return { admissions_status: 'Density Resident', status: 'Active' };
    if (s.includes('not admitted')) return { admissions_status: 'Not Admitted', status: 'Not Admitted' };
    if (s.includes('admitted') || s.includes('onboarding')) return { admissions_status: 'Active Resident', status: 'Active' };
    if (s.includes('hold') || s.includes('nurture')) return { admissions_status: 'Hold/Nurture', status: 'Hold' };
    return { admissions_status: 'Hold/Nurture', status: 'Hold' };
  }

  if (s.includes('not admitted')) return { admissions_status: 'Not Admitted', status: 'Not Admitted' };
  if (s.includes('admitted')) return { admissions_status: 'Active Resident', status: 'Active' };
  if (s.includes('hold') || s.includes('nurture')) return { admissions_status: 'Hold/Nurture', status: 'Hold' };
  return { admissions_status: 'Sourced', status: 'Sourced' };
}

function parseLocation(hq) {
  if (!Array.isArray(hq) || hq.length === 0) return { city: null, state: null };
  const loc = hq[0];
  const cityStateMap = {
    'Chicago': 'IL', 'Bay Area': 'CA', 'New York': 'NY', 'Boston': 'MA',
    'Seattle': 'WA', 'Los Angeles': 'CA', 'Evanston': 'IL', 'Ann Arbor': 'MI',
    'Milwaukee': 'WI', 'Orlando': 'FL', 'Chattanooga': 'TN', 'Boulder': 'CO', 'Houston': 'TX',
  };
  if (cityStateMap[loc]) return { city: loc, state: cityStateMap[loc] };
  if (loc.includes(',')) {
    const parts = loc.split(',');
    return { city: parts[0].trim(), state: parts[1]?.trim() || null };
  }
  return { city: loc, state: null };
}

async function syncFromAirtable() {
  if (!AIRTABLE_API_KEY) {
    console.warn('[AirtableImport] No AIRTABLE_API_KEY set, skipping sync');
    return { imported: 0, skipped: 0 };
  }

  console.log('[AirtableImport] Fetching founders from Airtable...');
  const records = await fetchAirtable(FOUNDER_TABLE);
  console.log(`[AirtableImport] Fetched ${records.length} records from Airtable`);

  let imported = 0, skipped = 0;

  for (const record of records) {
    const f = record.fields || {};
    const name = (f['Founder Name'] || '').trim();
    if (!name || name === '?') { skipped++; continue; }

    // Check if already in Stu by airtable_founder_record_id
    const byRecordId = db.prepare(
      'SELECT id FROM founders WHERE airtable_founder_record_id = ? AND is_deleted = 0'
    ).get(record.id);
    if (byRecordId) { skipped++; continue; }

    // Check by name + company match
    const companyName = (f['Company Name'] || '').trim();
    let byNameCompany;
    if (companyName) {
      byNameCompany = db.prepare(
        "SELECT id FROM founders WHERE is_deleted = 0 AND LOWER(TRIM(name)) = LOWER(?) AND LOWER(TRIM(company)) = LOWER(?)"
      ).get(name, companyName);
    }
    if (!byNameCompany) {
      byNameCompany = db.prepare(
        "SELECT id FROM founders WHERE is_deleted = 0 AND LOWER(TRIM(name)) = LOWER(?)"
      ).get(name);
    }

    if (byNameCompany) {
      // Founder exists but missing airtable ID — backfill it
      db.prepare('UPDATE founders SET airtable_founder_record_id = ? WHERE id = ?')
        .run(record.id, byNameCompany.id);
      skipped++;
      continue;
    }

    // New founder — insert
    const pipelines = f['Pipeline'] || [];
    const isInvestment = Array.isArray(pipelines) && pipelines.includes('Investment');
    const rawAdmStatus = f['Admission Status'];
    const rawNextStep = f['Next Step Description'];
    const { admissions_status, status } = mapAdmissionStatus(rawAdmStatus, rawNextStep);
    const tracks = ['admissions'];
    if (isInvestment) tracks.push('investment');
    const { city, state } = parseLocation(f['HQ']);
    const stage = f['Current Stage'] || 'Pre-seed';

    try {
      db.prepare(`
        INSERT INTO founders (
          name, company, email, linkedin_url, website_url,
          location_city, location_state, stage, domain,
          status, source, company_one_liner, next_action,
          pipeline_tracks, admissions_status,
          previous_companies, airtable_founder_record_id, created_by
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1)
      `).run(
        name,
        companyName || null,
        f['Email'] || null,
        f['LinkedIn'] || null,
        f['Company Website'] || null,
        city, state,
        stage === 'Service' ? 'Pre-seed' : stage || 'Pre-seed',
        null,
        status,
        f['Source'] || null,
        f['Company One-Liner'] || null,
        f['Next Action / Notes'] || null,
        tracks.join(','),
        admissions_status,
        f['Previous Companies'] || null,
        record.id
      );
      imported++;
      console.log(`[AirtableImport] + ${name} | ${companyName || '(stealth)'} → ${admissions_status}`);
    } catch (err) {
      console.error(`[AirtableImport] ! ${name}: ${err.message}`);
    }
  }

  console.log(`[AirtableImport] Done: ${imported} imported, ${skipped} skipped (already exist)`);
  return { imported, skipped, total: records.length };
}

module.exports = { syncFromAirtable };
