// ══════════════════════════════════════════════════════════════════════════
// company-enrich.js — the company half of enrichment. None of this existed.
//
// Danny, 2026-07-15: "I want the same level of insight (for example, company
// pages on LinkedIn show how many people work there and have been hired at these
// companies over time). You can see where the founders previously worked, etc.
// I'll pay for enrichment."
//
// Only PERSON enrichment was wired (linkedin-enrich.js -> /api/v2/profile).
// Company-level data — headcount, growth, funding — was nowhere in the codebase.
//
// ── THE CONTRACT, verified against EnrichLayer's live docs 2026-07-15 ──
// Not assumed. The USPTO connector in this same repo calls an endpoint that has
// never existed and returns 0 forever because nobody checked, and the Form D
// connector shipped `locationCode` (singular) which EDGAR silently ignores —
// returning identical nationwide results for every state. Two bugs, one cause:
// an endpoint written from memory. So every path and parameter below is quoted
// from the docs.
//
//   GET /api/v2/company
//     url* , funding_data=include (+1cr), exit_data, acquisitions, extra, use_cache
//     -> company_size [min,max], company_size_on_linkedin, founded_year,
//        industry, hq{}, funding_data
//
//   GET /api/v2/company/employees/count
//     url* , at_date=YYYY-MM-DD (+1cr Growth tier / +5cr otherwise),
//     employment_status=current|past|all, estimated_employee_count=include (+1cr)
//     -> { estimated_employee_count, verified_employee_count }
//
// Auth: `Authorization: Bearer <key>` on both. Base cost 1 credit each.
//
// ── HEADCOUNT OVER TIME IS N CALLS, NOT ONE ──
// The endpoint returns a SNAPSHOT. `at_date` time-travels to one date. So a
// growth curve is one call per point, and the cost is linear in resolution. We
// take 4 points over 12 months (now, -3, -6, -12) — enough to see a slope, cheap
// enough to run across the whole pipeline. Danny's read is "are they hiring?",
// which needs a direction, not a daily series.
// ══════════════════════════════════════════════════════════════════════════

const https = require('https');
const db = require('../db');

let resolveKey, recordCost;
try { ({ resolveKey, recordCost } = require('../lib/providerKeys')); }
catch { resolveKey = () => null; recordCost = () => {}; }

const BASE = 'https://enrichlayer.com';

function httpGetJson(url, headers = {}) {
  return new Promise((resolve) => {
    try {
      const u = new URL(url);
      const req = https.request(
        { hostname: u.hostname, path: u.pathname + u.search, method: 'GET', headers },
        (res) => {
          let out = '';
          res.on('data', (c) => (out += c));
          res.on('end', () => {
            try { resolve({ status: res.statusCode, data: JSON.parse(out) }); }
            catch { resolve({ status: res.statusCode, data: null }); }
          });
        }
      );
      req.on('error', () => resolve({ status: 0, data: null }));
      req.setTimeout(20000, () => { req.destroy(); resolve({ status: 0, data: null }); });
      req.end();
    } catch { resolve({ status: 0, data: null }); }
  });
}

const iso = (d) => d.toISOString().slice(0, 10);
const monthsAgo = (n) => { const d = new Date(); d.setMonth(d.getMonth() - n); return iso(d); };

/** GET /api/v2/company — profile + optional funding. */
async function fetchCompanyProfile(linkedinUrl, key, { funding = true, deps = {} } = {}) {
  const get = deps.getJson || httpGetJson;
  const p = new URLSearchParams({ url: linkedinUrl, use_cache: 'if-present' });
  if (funding) p.set('funding_data', 'include');
  const { status, data } = await get(`${BASE}/api/v2/company?${p}`, { Authorization: `Bearer ${key}` });
  return status === 200 && data ? data : null;
}

/** GET /api/v2/company/employees/count at one date. Omit `at` for today. */
async function fetchHeadcountAt(linkedinUrl, key, at = null, { deps = {} } = {}) {
  const get = deps.getJson || httpGetJson;
  const p = new URLSearchParams({ url: linkedinUrl, use_cache: 'if-present', estimated_employee_count: 'include' });
  if (at) p.set('at_date', at);
  const { status, data } = await get(`${BASE}/api/v2/company/employees/count?${p}`, {
    Authorization: `Bearer ${key}`,
  });
  if (status !== 200 || !data) return null;
  // Prefer verified; fall back to estimated. Record WHICH — a verified 12 and an
  // estimated 12 are not the same claim, and a growth curve that silently mixes
  // them is a curve that can move without anyone being hired.
  const n = data.verified_employee_count ?? data.estimated_employee_count ?? null;
  if (n == null) return null;
  return { at: at || iso(new Date()), count: n, verified: data.verified_employee_count != null };
}

/**
 * The headcount curve. 4 points over 12 months.
 *
 * Returns { series, now, growth_12mo_pct, hiring } where `hiring` is a direction,
 * not a score. Deliberately coarse: Danny's question is "are they hiring?", and a
 * 3-person company going to 5 is +67% — a percentage on tiny numbers is noise
 * wearing precision's clothes. So the DELTA is reported alongside, and a slope
 * from fewer than 2 real points is null rather than 0.
 */
async function fetchHeadcountSeries(linkedinUrl, key, { deps = {}, points = [0, 3, 6, 12] } = {}) {
  const series = [];
  for (const m of points) {
    const pt = await fetchHeadcountAt(linkedinUrl, key, m === 0 ? null : monthsAgo(m), { deps });
    if (pt) series.push({ ...pt, months_ago: m });
  }
  if (!series.length) return null;

  const now = series.find((s) => s.months_ago === 0) || series[0];
  const oldest = series[series.length - 1];
  const span = oldest.months_ago - now.months_ago;

  // Null, not 0, when there's nothing to compare. An unmeasured company is not a
  // flat company — the same rule the conviction engine enforces on evidence.
  let growth = null, delta = null;
  if (series.length >= 2 && span > 0 && oldest.count > 0) {
    delta = now.count - oldest.count;
    growth = Math.round((delta / oldest.count) * 100);
  }

  // ── Suppress the percentage at pre-seed scale. ──
  // The first live run proved this: Permute went 1 -> 2 -> 3 -> 3 over 12 months
  // and the honest arithmetic is "+200% growth". True, and useless — they hired
  // two people. Danny's whole book is 2-10 person companies, so a percentage off
  // a base this small will ALWAYS be noise, and a number that reads as precise
  // while meaning nothing is worse than no number: it invites a comparison
  // between a 1->3 and a 40->120 that the arithmetic supports and reality does
  // not.
  //
  // So below a base of 5, the percentage is withheld and the DELTA is the
  // headline. "+2 people" is the whole truth about a seed-stage hire.
  const PCT_MIN_BASE = 5;
  const pctIsMeaningful = oldest.count >= PCT_MIN_BASE;

  return {
    series: series.sort((a, b) => b.months_ago - a.months_ago),
    now: now.count,
    verified: now.verified,
    // The headline at this stage. Always report the count of humans.
    delta_12mo: delta,
    // Null when the base is too small to carry a ratio. Not zero — unknowable.
    growth_12mo_pct: pctIsMeaningful ? growth : null,
    pct_suppressed: delta != null && !pctIsMeaningful ? `base of ${oldest.count} is too small for a percentage` : null,
    hiring: delta == null ? null : delta > 0 ? 'growing' : delta < 0 ? 'shrinking' : 'flat',
  };
}

/**
 * Enrich one company. Returns the blob we persist, or null if nothing came back.
 * Never throws — an enrichment failure must not take down a page load.
 */
async function enrichCompany(linkedinUrl, { userId = 1, deps = {}, withSeries = true } = {}) {
  // `'key' in deps` — NOT `deps.key || resolveKey(...)`.
  //
  // The || form cannot express "no key": passing key:null falls through to the
  // database and finds the real one, so a caller trying to run dormant makes a
  // live billable call instead. The dormancy test passed for a year only because
  // no key was configured; the moment Danny's landed on 2026-07-15 it went red
  // and exposed this. A test that only passes when a feature is switched off is
  // not testing the feature.
  const key = 'key' in deps ? deps.key : resolveKey ? resolveKey(userId, 'enrichlayer') : null;
  if (!key || !linkedinUrl) return null;

  const profile = await fetchCompanyProfile(linkedinUrl, key, { deps });
  if (!profile) return null;

  const headcount = withSeries ? await fetchHeadcountSeries(linkedinUrl, key, { deps }) : null;

  // ~2 credits for the profile (+funding), ~4 for the series. Recorded so the
  // spend cap is real rather than decorative.
  if (recordCost) {
    try { recordCost(userId, 'enrichlayer', withSeries ? 6 : 2); } catch { /* never fatal */ }
  }

  return {
    fetched_at: new Date().toISOString(),
    name: profile.name || null,
    tagline: profile.tagline || null,
    description: profile.description || null,
    website: profile.website || null,
    industry: profile.industry || null,
    founded_year: profile.founded_year || null,
    // company_size is a [min,max] RANGE; company_size_on_linkedin is an integer.
    // They disagree constantly. Keep both rather than pick — the range is
    // LinkedIn's self-reported bucket, the integer is the actual profile count.
    size_range: profile.company_size || null,
    size_on_linkedin: profile.company_size_on_linkedin ?? null,
    hq: profile.hq || null,
    linkedin_url: linkedinUrl,
    funding: profile.funding_data || null,
    headcount,
  };
}

/** Persist onto a founder row. Column added lazily in db.js. */
function saveCompanyEnrichment(founderId, blob) {
  db.prepare('UPDATE founders SET company_enrichment = ?, company_enriched_at = CURRENT_TIMESTAMP WHERE id = ?')
    .run(JSON.stringify(blob), founderId);
}

function getCompanyEnrichment(founderId) {
  const r = db.prepare('SELECT company_enrichment FROM founders WHERE id = ?').get(founderId);
  if (!r?.company_enrichment) return null;
  try { return JSON.parse(r.company_enrichment); } catch { return null; }
}

module.exports = {
  enrichCompany,
  fetchCompanyProfile,
  fetchHeadcountAt,
  fetchHeadcountSeries,
  saveCompanyEnrichment,
  getCompanyEnrichment,
};
