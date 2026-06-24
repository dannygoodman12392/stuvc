/**
 * uspto-trademark.js — SourceConnector for USPTO trademark filings.
 *
 * Why it's high-signal: a founder names their company/product (and files a trademark)
 * months before any launch or LinkedIn change — and the filing names the OWNER and their
 * address (state). A new mark from an Illinois owner in your sectors is one of the
 * earliest possible "someone is building X" signals.
 *
 * Data: USPTO Open Data Portal trademark search (free, requires a free USPTO_API_KEY).
 * The connector is DORMANT (returns []) until that key is set, so it never breaks a run.
 * The HTTP call is isolated behind deps.getJson so the normalizer is unit-testable
 * without network. The exact ODP endpoint/params should be smoke-tested once a key is in.
 */
const https = require('https');

// USPTO Open Data Portal trademark search. Endpoint/params are configurable so a deploy
// can correct them without a code change if the ODP contract differs.
const SEARCH_URL = process.env.USPTO_TRADEMARK_URL || 'https://data.uspto.gov/api/v1/trademarks/search';

function httpGetJson(url, headers = {}) {
  return new Promise((resolve) => {
    try {
      const u = new URL(url);
      const req = https.request({ hostname: u.hostname, path: u.pathname + u.search, method: 'GET', headers }, (res) => {
        let out = '';
        res.on('data', c => out += c);
        res.on('end', () => { try { resolve({ status: res.statusCode, data: JSON.parse(out) }); } catch { resolve({ status: res.statusCode, data: null }); } });
      });
      req.on('error', () => resolve({ status: 0, data: null }));
      req.end();
    } catch { resolve({ status: 0, data: null }); }
  });
}

function tsdrUrl(serial) {
  return serial ? `https://tsdr.uspto.gov/#caseNumber=${serial}&caseType=SERIAL_NO&searchType=statusSearch` : null;
}

// Map one USPTO trademark record → a normalized RawRecord. Defensive about field shapes
// (the ODP nests owner/address differently across endpoints), so it tolerates partial data.
function normalize(rec) {
  if (!rec) return null;
  const mark = rec.markText || rec.wordMark || rec.markLiteralElements || rec.mark || null;
  const serial = rec.serialNumber || rec.serial || rec.serialNo || null;
  const filingDate = rec.filingDate || rec.filing_date || rec.applicationDate || null;
  const owners = rec.owners || rec.parties || rec.ownerGroups || [];
  const owner = Array.isArray(owners) ? owners[0] : owners;
  const ownerName = owner && (owner.name || owner.ownerName || owner.partyName) || null;
  const addr = owner && (owner.address || owner.ownerAddress || {}) || {};
  const state = addr.state || addr.region || addr.stateCode || rec.ownerState || null;
  const city = addr.city || addr.locality || null;
  // Person vs company owner: USPTO encodes individuals as ownerType/partyType "1".
  const ownerType = owner && (owner.ownerType || owner.partyType || owner.entityType);
  const isPerson = ownerType === '1' || ownerType === 1 || /individual/i.test(String(ownerType || ''));

  return {
    name: isPerson ? ownerName : null,
    entity_name: ownerName || (mark ? `${mark} (mark)` : null),
    role: 'Founder',
    headline: mark ? `Trademark filed: "${mark}"` : 'Trademark filing',
    location_state: state || null,
    location_city: city || null,
    evidence: [mark ? `Filed trademark "${mark}"` : 'Trademark filing', filingDate ? `on ${filingDate}` : null, ownerName ? `by ${ownerName}` : null, city || state ? `(${[city, state].filter(Boolean).join(', ')})` : null].filter(Boolean).join(' '),
    url: tsdrUrl(serial),
    raw: rec,
  };
}

// Pull recent filings, optionally state-scoped to the user's locations (IL for the owner).
async function fetch({ since = null, criteria = {}, limit = 50, deps = {} } = {}) {
  const apiKey = process.env.USPTO_API_KEY;
  if (!apiKey) return []; // dormant until a (free) USPTO ODP key is configured
  const getJson = deps.getJson || httpGetJson;

  // Derive a state filter from the user's locations (Chicago/IL → "IL"). Broad if none.
  const wantsIL = (criteria.locations || []).some(l => /illinois|chicago|evanston|naperville|\bil\b/i.test(l));
  const params = new URLSearchParams({ rows: String(Math.min(limit, 100)) });
  if (since) params.set('filingDateFrom', since);
  if (wantsIL) params.set('ownerState', 'IL');

  const { status, data } = await getJson(`${SEARCH_URL}?${params.toString()}`, { 'x-api-key': apiKey, Accept: 'application/json' });
  if (status !== 200 || !data) return [];
  const records = data.results || data.trademarks || data.docs || (Array.isArray(data) ? data : []);
  return records.map(normalize).filter(Boolean);
}

module.exports = {
  key: 'uspto_trademark',
  label: 'USPTO trademark filings',
  emits: 'trademark_filing',
  free: true,
  cadence: 'daily',
  fetch,
  normalize, // exported for tests
};
