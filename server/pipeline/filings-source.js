/**
 * R2 — Entity filings as a leading-indicator data source
 * =======================================================
 * Pulls SEC EDGAR Form D filings (Regulation D exempt offerings — filed within
 * 15 days of first sale of securities, i.e. first real capital raised) with
 * filer-state = IL, and inserts into `entity_filings` for matching against the
 * sourced_founders queue.
 *
 * Form D is one of the highest-signal leading indicators in existence:
 * - Free public data
 * - Filed by founders themselves (not VCs)
 * - Captures pre-seed raises that never show up in Crunchbase
 * - 2-4 week lead time vs. LinkedIn updates
 *
 * Endpoint: https://efts.sec.gov/LATEST/search-index?q=&dateRange=custom&startdt=...&enddt=...&forms=D&locationCode=IL
 * JSON API: https://efts.sec.gov/LATEST/search-index?... (undocumented but stable)
 */

const https = require('https');
const db = require('../db');

function httpsGet(url, headers = {}) {
  return new Promise((resolve) => {
    const parsed = new URL(url);
    const req = https.request({
      hostname: parsed.hostname,
      path: parsed.pathname + parsed.search,
      method: 'GET',
      headers: {
        // SEC requires a descriptive User-Agent with contact info
        'User-Agent': 'Superior Studios (superior.studios sourcing@superior.studios)',
        'Accept': 'application/json',
        ...headers,
      },
    }, (res) => {
      let body = '';
      res.on('data', d => body += d);
      res.on('end', () => {
        try { resolve({ status: res.statusCode, data: JSON.parse(body) }); }
        catch { resolve({ status: res.statusCode, data: body }); }
      });
    });
    req.on('error', () => resolve({ status: 0, data: null }));
    req.end();
  });
}

// Fetch SEC EDGAR Form D filings for Illinois-based filers, last N days.
// Uses the EDGAR full-text search JSON API (efts.sec.gov/LATEST/search-index).
async function fetchFormDIL({ days = 30 }) {
  const end = new Date();
  const start = new Date(end.getTime() - days * 24 * 60 * 60 * 1000);
  const fmt = d => d.toISOString().slice(0, 10);
  const url = `https://efts.sec.gov/LATEST/search-index?q=&dateRange=custom&startdt=${fmt(start)}&enddt=${fmt(end)}&forms=D&locationCode=IL`;

  const { status, data } = await httpsGet(url);
  if (status !== 200 || !data || !data.hits || !data.hits.hits) return [];

  const out = [];
  for (const hit of data.hits.hits) {
    const s = hit._source || {};
    const idArr = hit._id ? String(hit._id).split(':') : [];
    const accession = idArr[0] || s.adsh || hit._id;
    out.push({
      source: 'sec_form_d',
      filing_type: 'Form D',
      filing_id: accession,
      entity_name: (s.display_names && s.display_names[0]) || s.entityName || null,
      officer_names: [],  // parsed on-demand from the filing doc if needed
      state: 'IL',
      city: s.locationCode === 'IL' ? (s.biz_states && s.biz_states[0]) || null : null,
      filed_at: s.file_date || null,
      raw_data: s,
    });
  }
  return out;
}

// Upsert filings into entity_filings
function upsertFilings(filings) {
  const stmt = db.prepare(`
    INSERT OR IGNORE INTO entity_filings
      (source, filing_type, filing_id, entity_name, officer_names, state, city, filed_at, raw_data)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);
  let inserted = 0;
  for (const f of filings) {
    const res = stmt.run(
      f.source,
      f.filing_type,
      f.filing_id,
      f.entity_name,
      JSON.stringify(f.officer_names || []),
      f.state,
      f.city,
      f.filed_at,
      JSON.stringify(f.raw_data || {})
    );
    if (res.changes > 0) inserted++;
  }
  return inserted;
}

// Match filings to sourced_founders by entity-name fuzzy match.
// If a filing's entity_name contains a candidate's company or vice versa,
// link it. Tag matched candidate's builder_signals with "Filed Form D (SEC)".
function matchFilingsToCandidates({ userId }) {
  const unmatched = db.prepare(`
    SELECT id, entity_name FROM entity_filings
    WHERE matched_to_candidate_id IS NULL AND state = 'IL'
    ORDER BY filed_at DESC LIMIT 500
  `).all();

  if (unmatched.length === 0) return { matched: 0 };

  const candidates = db.prepare(`
    SELECT id, name, company, builder_signals
    FROM sourced_founders
    WHERE user_id = ? AND status IN ('pending', 'starred') AND company IS NOT NULL AND company != ''
  `).all(userId);

  let matched = 0;
  const linkStmt = db.prepare('UPDATE entity_filings SET matched_to_candidate_id = ? WHERE id = ?');
  const tagStmt = db.prepare(`
    UPDATE sourced_founders
    SET builder_signals = ?, confidence_score = MIN(10, confidence_score + 1)
    WHERE id = ? AND user_id = ?
  `);

  for (const f of unmatched) {
    if (!f.entity_name) continue;
    const fname = f.entity_name.toLowerCase();
    for (const c of candidates) {
      const cname = (c.company || '').toLowerCase();
      if (cname.length < 3) continue;
      if (fname.includes(cname) || cname.includes(fname.split(' ')[0])) {
        linkStmt.run(c.id, f.id);
        let bs = [];
        try { bs = JSON.parse(c.builder_signals || '[]'); } catch {}
        if (!bs.some(s => /Filed Form D/i.test(s))) {
          bs.push('Filed Form D (SEC)');
          tagStmt.run(JSON.stringify(bs), c.id, userId);
        }
        matched++;
        break;
      }
    }
  }
  return { matched };
}

// Main entry point — called nightly via cron.
async function runFilingsSource({ userId = 1, days = 30 } = {}) {
  try {
    const filings = await fetchFormDIL({ days });
    const inserted = upsertFilings(filings);
    const { matched } = matchFilingsToCandidates({ userId });
    console.log(`[Filings] SEC Form D IL: fetched=${filings.length}, inserted=${inserted}, matched=${matched}`);
    return { fetched: filings.length, inserted, matched };
  } catch (err) {
    console.error('[Filings] Error:', err.message);
    return { error: err.message };
  }
}

module.exports = { runFilingsSource, fetchFormDIL, matchFilingsToCandidates };
