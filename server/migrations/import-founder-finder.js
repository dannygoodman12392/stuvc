/**
 * Migration: Import all Founder Finder data into Stu
 *
 * Data sources:
 * 1. Master pipeline CSV (5,200 founders with V3 scores)
 * 2. Pipeline state JSON (379 founders with status: passed/contacted/meeting)
 * 3. Scorecard Engine JSON (6 founders with detailed AI scorecards)
 *
 * This script is idempotent — it deduplicates by LinkedIn URL.
 */

require('dotenv').config({ path: require('path').join(__dirname, '..', '..', '.env') });
const fs = require('fs');
const path = require('path');
const db = require('../db');

const COWORK = path.join(__dirname, '..', '..', '..');
const MASTER_CSV = path.join(COWORK, 'deploy', 'data', 'ss_master_pipeline.csv');
const PIPELINE_STATE = path.join(COWORK, 'deploy', 'data', 'pipeline_state.json');
const SCORECARDS = path.join(COWORK, 'Founder Scorecard Engine', 'data', 'scorecards.json');

// Map Founder Finder statuses to Stu statuses
const STATUS_MAP = {
  'passed': 'Passed',
  'contacted': 'Contacted',
  'meeting': 'Meeting Scheduled',
  'interested': 'Active Diligence',
  'invested': 'Invested',
  'evaluating': 'Identified',
};

function parseCSV(content) {
  const lines = content.split('\n');
  const headers = parseCSVLine(lines[0]);
  const rows = [];
  for (let i = 1; i < lines.length; i++) {
    if (!lines[i].trim()) continue;
    const values = parseCSVLine(lines[i]);
    const row = {};
    headers.forEach((h, idx) => { row[h.trim()] = (values[idx] || '').trim(); });
    rows.push(row);
  }
  return rows;
}

function parseCSVLine(line) {
  const result = [];
  let current = '';
  let inQuotes = false;
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (c === '"') {
      if (inQuotes && line[i + 1] === '"') {
        current += '"';
        i++;
      } else {
        inQuotes = !inQuotes;
      }
    } else if (c === ',' && !inQuotes) {
      result.push(current);
      current = '';
    } else {
      current += c;
    }
  }
  result.push(current);
  return result;
}

function computeFitScore(row) {
  // Convert V3 scores to a 1-10 fit score
  const cred = parseInt(row.V3_Credibility) || 0;
  const market = parseInt(row.V3_MarketFit) || 0;
  const vel = parseInt(row.V3_Velocity) || 0;
  const net = parseInt(row.V3_Network) || 0;
  const geo = parseInt(row.V3_Geographic) || 0;
  const comp = parseInt(row.V3_Compounding) || 0;
  const neg = parseInt(row.V3_Negatives) || 0;
  const raw = cred + market + vel + net + geo + comp - neg;
  // Raw range is roughly 0-100, map to 1-10
  return Math.max(1, Math.min(10, Math.round(raw / 10)));
}

function inferDomain(headline, traits) {
  const text = `${headline} ${traits}`.toLowerCase();
  if (text.includes('ai') || text.includes('machine learning') || text.includes('ml')) return 'AI Infrastructure';
  if (text.includes('saas') || text.includes('b2b')) return 'B2B SaaS';
  if (text.includes('fintech') || text.includes('finance') || text.includes('payments')) return 'Fintech';
  if (text.includes('health') || text.includes('biotech') || text.includes('med')) return 'Healthtech';
  if (text.includes('marketplace') || text.includes('platform')) return 'Marketplace';
  if (text.includes('software') || text.includes('dev')) return 'Vertical Software';
  return '';
}

function inferStage(bucket) {
  const b = (bucket || '').toLowerCase();
  if (b.includes('stealth') || b.includes('pre-seed') || b.includes('pre seed')) return 'Pre-seed';
  if (b.includes('seed') || b.includes('early')) return 'Seed';
  if (b.includes('series')) return 'Series A';
  return 'Pre-seed';
}

function buildNotableBackground(traits) {
  if (!traits) return '';
  const parts = traits.split(';').map(t => t.trim()).filter(Boolean);
  const notable = parts.filter(p => {
    const lower = p.toLowerCase();
    return lower.includes('yc') || lower.includes('stanford') || lower.includes('mit') ||
           lower.includes('harvard') || lower.includes('northwestern') || lower.includes('uchicago') ||
           lower.includes('illinois') || lower.includes('exit') || lower.includes('acquired') ||
           lower.includes('phd') || lower.includes('google') || lower.includes('meta') ||
           lower.includes('facebook') || lower.includes('apple') || lower.includes('amazon') ||
           lower.includes('stripe') || lower.includes('elite') || lower.includes('openai');
  });
  return notable.join(', ');
}

function run() {
  console.log('=== Stu Migration: Importing Founder Finder Data ===\n');

  // Get admin user for created_by
  const admin = db.prepare("SELECT id FROM users WHERE email = 'danny@superiorstudios.co'").get();
  const userId = admin?.id || 1;

  // Track existing LinkedIn URLs to avoid duplicates
  const existing = new Set();
  db.prepare('SELECT linkedin_url FROM founders WHERE linkedin_url IS NOT NULL').all()
    .forEach(r => existing.add(r.linkedin_url));
  console.log(`Existing founders in Stu: ${existing.size}`);

  // ── 1. Import master CSV ──
  let imported = 0;
  let skipped = 0;
  let pipelineStateData = {};

  if (fs.existsSync(PIPELINE_STATE)) {
    pipelineStateData = JSON.parse(fs.readFileSync(PIPELINE_STATE, 'utf8'));
    console.log(`Pipeline state loaded: ${Object.keys(pipelineStateData).length} entries`);
  }

  if (fs.existsSync(MASTER_CSV)) {
    const rows = parseCSV(fs.readFileSync(MASTER_CSV, 'utf8'));
    console.log(`Master CSV loaded: ${rows.length} founders`);

    const insertStmt = db.prepare(`
      INSERT INTO founders (name, company, role, linkedin_url, location_city, location_state,
        stage, domain, status, source, fit_score, fit_score_rationale, bio, notable_background,
        chicago_connection, created_by, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);

    const insertMany = db.transaction((rows) => {
      for (const row of rows) {
        const linkedin = row['LinkedIn URL'];
        if (!linkedin || existing.has(linkedin)) { skipped++; continue; }
        if (!row.Name) { skipped++; continue; }

        existing.add(linkedin);

        // Determine status from pipeline state
        const stateEntry = pipelineStateData[linkedin];
        let status = 'Identified';
        if (stateEntry) {
          status = STATUS_MAP[stateEntry.status] || 'Identified';
        }

        const fitScore = computeFitScore(row);
        const domain = inferDomain(row.Headline || '', row['Key Traits'] || '');
        const stage = inferStage(row.Buckets || '');
        const notable = buildNotableBackground(row['Key Traits'] || '');

        // Chicago connection detection
        const traits = (row['Key Traits'] || '').toLowerCase();
        const locType = (row['Location Type'] || '').toLowerCase();
        const loc = (row.Location || '').toLowerCase();
        let chicagoConnection = '';
        if (loc.includes('chicago') || loc.includes('illinois')) {
          chicagoConnection = locType === 'current' ? 'Based in Chicago' :
            locType === 'origin' ? 'From Chicago area' : 'Chicago connection';
        }
        if (traits.includes('uchicago') || traits.includes('university of chicago')) {
          chicagoConnection += chicagoConnection ? '; UChicago alum' : 'UChicago alum';
        }
        if (traits.includes('northwestern')) {
          chicagoConnection += chicagoConnection ? '; Northwestern alum' : 'Northwestern alum';
        }

        const rationale = [
          row.Buckets ? `Bucket: ${row.Buckets}` : '',
          row.Score ? `Source score: ${row.Score}/100` : '',
          row.MustLookAt === 'MUST' ? 'Flagged as MUST LOOK AT' : '',
        ].filter(Boolean).join('. ');

        const city = row.City || (loc.includes('chicago') ? 'Chicago' : '');
        const state = row.State || (loc.includes('chicago') || loc.includes('illinois') ? 'IL' : '');
        const source = row.Sources || 'Founder Finder';
        const createdAt = row['First Seen'] || new Date().toISOString().split('T')[0];

        insertStmt.run(
          row.Name, row['Current Company'] || '', row['Current Title'] || '',
          linkedin, city, state, stage, domain, status, source,
          fitScore, rationale, row.Summary || row.Headline || '',
          notable, chicagoConnection, userId, createdAt
        );
        imported++;
      }
    });

    insertMany(rows);
    console.log(`Master CSV: imported ${imported}, skipped ${skipped} (duplicates/empty)`);
  }

  // ── 2. Import Scorecard Engine data ──
  let scorecardImported = 0;
  if (fs.existsSync(SCORECARDS)) {
    const scorecardData = JSON.parse(fs.readFileSync(SCORECARDS, 'utf8'));
    const founders = scorecardData.founders || {};

    console.log(`\nScorecard Engine loaded: ${Object.keys(founders).length} founders`);

    for (const [id, founder] of Object.entries(founders)) {
      if (!founder.name) continue;

      // Check if already imported by name match
      const existingFounder = db.prepare(
        'SELECT id FROM founders WHERE name LIKE ? AND is_deleted = 0'
      ).get(`%${founder.name}%`);

      if (existingFounder) {
        // Add scorecard data as notes to existing founder
        for (const score of (founder.scores || [])) {
          const content = formatScorecardAsNote(founder, score);
          db.prepare('INSERT INTO founder_notes (founder_id, content, created_by) VALUES (?, ?, ?)')
            .run(existingFounder.id, content, userId);
        }
        console.log(`  Scorecard for ${founder.name}: added as notes to existing founder #${existingFounder.id}`);
      } else {
        // Create new founder + notes
        const latestScore = founder.scores?.[founder.scores.length - 1];
        const conviction = latestScore?.overall_conviction?.score || 0;
        const fitScore = Math.max(1, Math.min(10, Math.round(conviction * 2)));

        const result = db.prepare(`
          INSERT INTO founders (name, company, status, fit_score, fit_score_rationale, source, created_by, created_at)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?)
        `).run(
          founder.name,
          founder.company || '',
          STATUS_MAP[founder.status] || 'Identified',
          fitScore,
          latestScore?.overall_conviction?.narrative || '',
          'Scorecard Engine',
          userId,
          founder.created_at || new Date().toISOString()
        );

        for (const score of (founder.scores || [])) {
          const content = formatScorecardAsNote(founder, score);
          db.prepare('INSERT INTO founder_notes (founder_id, content, created_by) VALUES (?, ?, ?)')
            .run(result.lastInsertRowid, content, userId);
        }
        scorecardImported++;
        console.log(`  Scorecard for ${founder.name}: created as new founder #${result.lastInsertRowid}`);
      }
    }
  }

  // ── Summary ──
  const totalFounders = db.prepare('SELECT COUNT(*) as count FROM founders WHERE is_deleted = 0').get().count;
  const totalNotes = db.prepare('SELECT COUNT(*) as count FROM founder_notes').get().count;
  const byStatus = db.prepare('SELECT status, COUNT(*) as count FROM founders WHERE is_deleted = 0 GROUP BY status ORDER BY count DESC').all();

  console.log('\n=== Migration Complete ===');
  console.log(`Total founders in Stu: ${totalFounders}`);
  console.log(`Total notes: ${totalNotes}`);
  console.log('By status:');
  byStatus.forEach(s => console.log(`  ${s.status}: ${s.count}`));
}

function formatScorecardAsNote(founder, score) {
  const lines = [
    `[Scorecard — Meeting #${score.meeting_number || 1}]`,
    `Scored: ${score.scored_at || 'Unknown date'}`,
    '',
  ];

  if (score.criteria) {
    for (const [key, val] of Object.entries(score.criteria)) {
      const label = key === 'builder_motivator' ? 'Builder + Motivator' : key.charAt(0).toUpperCase() + key.slice(1);
      lines.push(`${label}: ${val.score}/5.0 (${val.confidence} confidence)`);
      if (val.evidence) lines.push(`  Evidence: ${val.evidence}`);
      lines.push('');
    }
  }

  if (score.overall_conviction) {
    lines.push(`Overall Conviction: ${score.overall_conviction.score}/5.0`);
    if (score.overall_conviction.narrative) lines.push(score.overall_conviction.narrative);
    lines.push('');
  }

  if (score.red_flags?.length) {
    lines.push('Red Flags:');
    score.red_flags.forEach(rf => {
      lines.push(`  [${rf.severity}] ${rf.flag}: ${rf.detail}`);
    });
    lines.push('');
  }

  if (score.lp_narrative) {
    lines.push(`LP Narrative: ${score.lp_narrative}`);
  }

  return lines.join('\n');
}

// Run
run();
