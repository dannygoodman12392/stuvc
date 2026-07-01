/**
 * yc-directory.js — SourceConnector for the Y Combinator public company directory.
 *
 * Why it's high-signal: every YC company is a funded, vetted early-stage team, named the
 * moment it's public. This is the single largest early-builder cohort. We pull it two ways:
 *   1. Location-targeted queries (the user's own locations, e.g. Chicago/Illinois) → the
 *      IL-tied companies that belong in the deal pipeline.
 *   2. A recency pull (newest launches) → the national picture for the frontier watchlist.
 * The shared ingest pipeline then geo-partitions: IL ties → pipeline, the rest → watchlist.
 *
 * Data: YC's public Algolia search index (the same one ycombinator.com/companies uses).
 * The app id / search key / index are env-overridable because YC rotates the public search
 * key periodically; the baked-in defaults are the current public credentials. If the key
 * rotates and the fetch starts returning nothing, refresh YC_ALGOLIA_API_KEY (grab the
 * current one from the `AlgoliaOpts` blob on ycombinator.com/companies).
 *
 * FOUNDER RESOLUTION: the IL tie Danny cares about most (school — UChicago/UIUC/Northwestern —
 * plus hometown and prior work) lives in the FOUNDER's background, not the company's HQ. So for
 * each early-stage company we fetch its public YC page, parse the founders (name, role, bio,
 * LinkedIn), and emit one person-level record per founder whose bio carries that background. The
 * shared geo gate then reads the founder's bio, catching e.g. a UChicago alum whose company is
 * headquartered in SF. Pages are fetched once and cached (yc_resolved) so the daily cron never
 * re-crawls; resolution is capped per run and drains the backlog over successive runs. If a page
 * can't be parsed we fall back to a company-level record (geo'd on the company location).
 *
 * The HTTP calls are isolated behind deps.getJson / deps.getHtml so the parsers are unit-testable
 * offline; pass opts.resolveFounders=false to skip page resolution entirely (used by tests).
 */
const https = require('https');
const cheerio = require('cheerio');

// Max company pages to resolve per run (the daily cron drains the rest next run). Tunable.
const RESOLVE_MAX = parseInt(process.env.YC_RESOLVE_MAX || '120', 10);

const APP_ID = process.env.YC_ALGOLIA_APP_ID || '45BWZJ1SGC';
const API_KEY = process.env.YC_ALGOLIA_API_KEY ||
  'NzllNTY5MzJiZGM2OTY2ZTQwMDEzOTNhYWZiZGRjODlhYzVkNjBmOGRjNzJiMWM4ZTU0ZDlhYTZjOTJiMjlhMWFuYWx5dGljc1RhZ3M9eWNkYyZyZXN0cmljdEluZGljZXM9WUNDb21wYW55X3Byb2R1Y3Rpb24lMkNZQ0NvbXBhbnlfQnlfTGF1bmNoX0RhdGVfcHJvZHVjdGlvbiZ0YWdGaWx0ZXJzPSU1QiUyMnljZGNfcHVibGljJTIyJTVE';
const INDEX = process.env.YC_ALGOLIA_INDEX || 'YCCompany_production';
const INDEX_BY_DATE = process.env.YC_ALGOLIA_INDEX_BY_DATE || 'YCCompany_By_Launch_Date_production';

// Early-stage gate — Danny's fund is pre-seed; we must NOT surface growth-stage YC alumni.
// The YC directory spans every batch back to 2005, so a raw pull includes Tovala, ShipBob,
// Fly.io, etc. We keep only: stage "Early" (drops Growth/Late), status "Active" (drops
// Acquired/Public/Inactive), a recent batch (the real pre-seed/seed window), and a small
// team (a backstop, since a few old "Early"-tagged cos have 100+ headcount). All tunable.
const MIN_BATCH_YEAR = parseInt(process.env.YC_MIN_BATCH_YEAR || '2025', 10);
const MAX_TEAM_SIZE = parseInt(process.env.YC_MAX_TEAM_SIZE || '25', 10);

// Year of a company's batch ("Winter 2016" → 2016), falling back to its launch timestamp.
function parseBatchYear(hit) {
  const m = /(\d{4})/.exec((hit && hit.batch) || '');
  if (m) return parseInt(m[1], 10);
  if (hit && hit.launched_at) { try { return new Date(hit.launched_at * 1000).getUTCFullYear(); } catch { /* ignore */ } }
  return null;
}

// True only for pre-seed/early-seed-shaped companies (see gate rationale above).
function isEarlyStage(hit, { minYear = MIN_BATCH_YEAR, maxTeam = MAX_TEAM_SIZE } = {}) {
  if (!hit) return false;
  if (hit.stage && String(hit.stage).toLowerCase() !== 'early') return false;
  if (hit.status && String(hit.status).toLowerCase() !== 'active') return false;
  const yr = parseBatchYear(hit);
  if (yr == null || yr < minYear) return false;
  if (typeof hit.team_size === 'number' && hit.team_size > maxTeam) return false;
  return true;
}

function httpPostJson(url, headers, body) {
  return new Promise((resolve) => {
    try {
      const u = new URL(url);
      const data = JSON.stringify(body);
      const req = https.request({
        hostname: u.hostname, path: u.pathname + u.search, method: 'POST',
        headers: { ...headers, 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(data) },
      }, (res) => {
        let out = '';
        res.on('data', c => out += c);
        res.on('end', () => { try { resolve({ status: res.statusCode, data: JSON.parse(out) }); } catch { resolve({ status: res.statusCode, data: null }); } });
      });
      req.on('error', () => resolve({ status: 0, data: null }));
      req.write(data); req.end();
    } catch { resolve({ status: 0, data: null }); }
  });
}

// One Algolia query against an index. Returns the raw hits array (never throws).
async function algoliaQuery(getJson, { index, query = '', hitsPerPage = 50 }) {
  const host = `${APP_ID.toLowerCase()}-dsn.algolia.net`;
  const url = `https://${host}/1/indexes/${encodeURIComponent(index)}/query`;
  const params = `query=${encodeURIComponent(query)}&hitsPerPage=${hitsPerPage}`;
  const { status, data } = await getJson(url, {
    'x-algolia-application-id': APP_ID,
    'x-algolia-api-key': API_KEY,
  }, { params });
  if (status !== 200 || !data || !Array.isArray(data.hits)) return [];
  return data.hits;
}

// "Chicago, IL, USA" (or "Chicago, IL, USA; Remote") → { city, state }. Tolerant of blanks.
function parseLocation(all_locations) {
  if (!all_locations || typeof all_locations !== 'string') return { city: null, state: null };
  const first = all_locations.split(';')[0].trim();
  const parts = first.split(',').map(s => s.trim()).filter(Boolean);
  return { city: parts[0] || null, state: parts[1] || null };
}

// Map one YC company hit → a normalized RawRecord. Company-level (founder resolved later).
function normalize(hit) {
  if (!hit || !hit.name) return null;
  const { city, state } = parseLocation(hit.all_locations);
  const inds = Array.isArray(hit.industries) ? hit.industries.filter(Boolean).join(', ') : (hit.industry || '');
  const slug = hit.slug || (hit.objectID ? String(hit.objectID) : null);
  const evidence = [
    hit.batch ? `YC ${hit.batch}.` : 'YC company.',
    hit.one_liner || hit.long_description ? (hit.one_liner || String(hit.long_description).slice(0, 160)) : null,
    inds ? `[${inds}]` : null,
    hit.all_locations ? `(${hit.all_locations})` : null,
  ].filter(Boolean).join(' ');
  return {
    name: null,                       // company-level; founder name resolved by enrichment
    entity_name: hit.name,
    company: hit.name,
    role: 'Founder',
    headline: hit.one_liner || (inds ? `${inds} · YC ${hit.batch || ''}`.trim() : `YC ${hit.batch || 'company'}`),
    location_city: city,
    location_state: state,
    website_url: hit.website || null,
    url: slug ? `https://www.ycombinator.com/companies/${slug}` : (hit.website || null),
    // Geo is gated on all_locations (parsed above), NOT the blurb — a company description that
    // happens to name an IL school must not mint a false IL "alumni" tie for a non-IL company.
    // So bio carries only the short one-liner; the full description rides along in `evidence`
    // for enrichment context, which the geo gate does not read.
    bio: hit.one_liner || '',
    evidence,
    raw: hit,
  };
}

// Build the query plan: location-targeted (pipeline yield) + recency (national watchlist).
// BOTH use the launch-date-sorted index so the freshest companies come first — otherwise the
// default index buries current-batch (pre-seed) companies under older, more popular ones, and
// the early-stage gate then filters those older ones out, starving the IL pipeline.
function buildQueryPlan(criteria = {}, limit = 50) {
  const plan = [];
  const locs = (criteria.locations || []).slice(0, 5).filter(Boolean);
  // Location queries scan the FULL match set on the default index (a location has a finite,
  // small all-time YC set), so the early-stage gate can keep every current pre-seed IL company
  // rather than only those in a shallow page. Non-IL "mentions Chicago" cos are routed to the
  // watchlist by the geo gate (it reads parsed location, not the blurb), so recall is safe.
  for (const loc of locs) plan.push({ index: INDEX, query: loc, hitsPerPage: 200 });
  // Newest launches (date-sorted) for the national frontier watch.
  plan.push({ index: INDEX_BY_DATE, query: '', hitsPerPage: Math.min(Math.max(limit, 50), 200) });
  return plan;
}

function httpGetHtml(url, headers = {}) {
  return new Promise((resolve) => {
    try {
      const u = new URL(url);
      const req = https.request({
        hostname: u.hostname, path: u.pathname + u.search, method: 'GET',
        headers: { 'User-Agent': 'SuperiorStudios-Stu/1.0 (sourcing)', Accept: 'text/html', ...headers },
      }, (res) => {
        let out = '';
        res.on('data', c => out += c);
        res.on('end', () => resolve({ status: res.statusCode, html: out }));
      });
      req.on('error', () => resolve({ status: 0, html: null }));
      req.end();
    } catch { resolve({ status: 0, html: null }); }
  });
}

function normalizeLinkedin(href) {
  if (!href || !/linkedin\.com\/in\//i.test(href)) return null;
  try { const u = new URL(href); return `https://www.linkedin.com${u.pathname}`.replace(/\/$/, ''); } catch { return href; }
}

// Parse the "Active Founders" cards from a YC company page. Each card (.ycdc-card-new) holds a
// bold name, a bio line (role + school + prior work), and social links. Returns deduped founders
// with { name, role, bio, linkedin_url }. Conservative: only cards with a person-like name count.
function parseFounders(html) {
  if (!html || typeof html !== 'string') return [];
  const $ = cheerio.load(html);
  const founders = [];
  const seen = new Set();
  $('.ycdc-card-new').each((_, el) => {
    const $c = $(el);
    const name = $c.find('.font-bold').first().text().trim().replace(/\s+/g, ' ');
    // Person-like: 2–4 capitalized words (drops job cards / section chrome that reuse the class).
    if (!name || !/^([A-Z][a-zA-Z.'’-]+)(\s+[A-Z][a-zA-Z.'’-]+){1,3}$/.test(name)) return;
    const linkedin = normalizeLinkedin($c.find('a[href*="linkedin.com/in"]').attr('href'));
    // Bio = card text minus the leading name (carries "CEO/Co-founder, UChicago, fmr …").
    // Build from HTML so block elements are space-separated (cheerio .text() glues them:
    // "founder</div><div>UChicago" → "founderUChicago"), then strip tags + decode entities.
    let text = ($c.html() || '')
      .replace(/<\/(div|p|li|br|h[1-6]|span)>/gi, ' ')
      .replace(/<[^>]+>/g, ' ')
      .replace(/&#x27;|&rsquo;/g, "'").replace(/&amp;/g, '&').replace(/&nbsp;/gi, ' ')
      .replace(/\s+/g, ' ').trim();
    if (text.startsWith(name)) text = text.slice(name.length).trim();
    // The card renders desktop + mobile copies inside one element, so name/role/bio repeat —
    // cut at the second occurrence of the name to keep a single clean bio.
    const dupAt = text.indexOf(name);
    if (dupAt > 0) text = text.slice(0, dupAt).trim();
    // A real founder card has a role title or a personal link; a name-shaped heading ("Open
    // Roles") has neither — require one so section chrome / job cards don't slip through.
    const roleMatch = /(ceo|cto|coo|co-?founder|founder|president)[^,·|]*/i.exec(text);
    if (!linkedin && !roleMatch) return;
    // Dedup by name: the page renders a desktop + mobile copy of each card, and only one copy
    // carries the social links — so keying on the link would leave both copies. Name-first keeps
    // the earlier (link-bearing) copy.
    const key = name.toLowerCase();
    if (seen.has(key)) return;
    seen.add(key);
    founders.push({ name, role: (roleMatch ? roleMatch[0] : 'Co-founder').trim(), bio: text, linkedin_url: linkedin });
  });
  return founders;
}

// A person-level RawRecord for one founder of a YC company. The founder's bio (school, hometown,
// prior work) is what the geo gate reads — so a UChicago alum ties to IL even if the company is
// headquartered elsewhere. Company HQ still rides along as a secondary location signal.
function founderRecord(hit, f) {
  const { city, state } = parseLocation(hit.all_locations);
  const inds = Array.isArray(hit.industries) ? hit.industries.filter(Boolean).join(', ') : (hit.industry || '');
  const slug = hit.slug || (hit.objectID ? String(hit.objectID) : null);
  return {
    name: f.name,
    entity_name: null,
    company: hit.name,
    role: f.role || 'Co-founder',
    headline: `${f.role || 'Co-founder'}, ${hit.name} (YC ${hit.batch || ''})`.trim(),
    // Founder background drives the IL tie (school/hometown/work), so it belongs in bio here —
    // unlike the company-level record, where a stray school mention would be a false tie.
    bio: [f.bio, hit.one_liner].filter(Boolean).join(' · '),
    location_city: city,
    location_state: state,
    linkedin_url: f.linkedin_url || null,
    website_url: null, // co-founders share a company site; keep it off so dedup keeps both people
    url: f.linkedin_url || (slug ? `https://www.ycombinator.com/companies/${slug}` : hit.website || null),
    evidence: `YC ${hit.batch || ''} · ${hit.name} · ${f.name}: ${f.bio}`.trim(),
    raw: { hit, founder: f },
  };
}

// Resolve-cache (so the daily cron crawls each company page at most once). Best-effort: if the DB
// isn't available (e.g. a pure unit test that never resolves), these degrade to no-ops.
function cacheDb() { try { return require('../../db'); } catch { return null; } }
function isResolved(d, slug) {
  if (!d || !slug) return false;
  try { return !!d.prepare('SELECT 1 FROM yc_resolved WHERE slug = ?').get(slug); } catch { return false; }
}
function markResolved(d, slug) {
  if (!d || !slug) return;
  try { d.prepare('INSERT OR IGNORE INTO yc_resolved (slug) VALUES (?)').run(slug); } catch { /* ignore */ }
}

async function fetch({ criteria = {}, limit = 50, deps = {}, opts = {} } = {}) {
  const getJson = deps.getJson || httpPostJson;
  const plan = buildQueryPlan(criteria, limit);

  // 1. Collect the early-stage companies across the query plan (deduped).
  const seen = new Set();
  const companies = [];
  for (const q of plan) {
    const hits = await algoliaQuery(getJson, q);
    for (const h of hits) {
      const key = String(h.objectID || h.slug || h.name || '').toLowerCase();
      if (!key || seen.has(key)) continue;
      seen.add(key);
      if (!isEarlyStage(h)) continue; // pre-seed only — no growth-stage YC alumni
      companies.push(h);
    }
  }

  // 2. Without founder resolution (tests), return company-level records.
  if (opts.resolveFounders === false) return companies.map(normalize).filter(Boolean);

  // 3. Resolve founders per company (page fetch + parse), capped and cached so the cron never
  //    re-crawls. A company already resolved in a prior run is skipped (its founders persist).
  const getHtml = deps.getHtml || httpGetHtml;
  const cap = opts.resolveMax ?? RESOLVE_MAX;
  const d = deps.db !== undefined ? deps.db : cacheDb();
  const out = [];
  let resolved = 0;
  for (const h of companies) {
    const slug = h.slug || (h.objectID ? String(h.objectID) : null);
    if (isResolved(d, slug)) continue;      // already crawled → its founders are already ingested
    if (resolved >= cap) continue;          // over budget this run → leave for the next run intact
    const page = await getHtml(`https://www.ycombinator.com/companies/${slug}`);
    markResolved(d, slug);
    resolved++;
    let founders = [];
    if (page && page.status === 200 && page.html) {
      try { founders = parseFounders(page.html); } catch { founders = []; }
    }
    if (founders.length) out.push(...founders.map(f => founderRecord(h, f)));
    else { const rec = normalize(h); if (rec) out.push(rec); } // fallback: company-level
  }
  return out;
}

module.exports = {
  key: 'yc_directory',
  label: 'Y Combinator company directory',
  emits: 'yc_company',
  free: true,
  cadence: 'daily',
  nationalWatchlist: true, // non-IL YC companies land on the frontier watch, not dropped
  fetch,
  // exported for tests
  normalize,
  parseLocation,
  buildQueryPlan,
  isEarlyStage,
  parseBatchYear,
  parseFounders,
  founderRecord,
};
