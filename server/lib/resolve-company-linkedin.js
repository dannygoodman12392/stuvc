'use strict';
// ══════════════════════════════════════════════════════════════════════════
// Find a company's LinkedIn page — and refuse when unsure.
//
// Danny: "I want the same level of insight (for example, company pages on LinkedIn
// show how many people work there and have been hired at these companies over
// time). You can see where the founders previously worked... I'll pay for
// enrichment."
//
// He was already paying for nothing. pipeline/company-enrich.js hard-requires
// `company_linkedin_url` and returns a 400 without one. Measured 2026-07-16:
// 2 of 105 investment-track cards had that field. So exactly ONE company in the
// book had ever been enriched. This is the missing link, and nothing else.
//
// ── WHY THIS FILE IS PARANOID ──
// The failure here is not "no result". It is a CONFIDENT WRONG result, and it is
// uniquely nasty: hand company-enrich the wrong URL and the card fills with a real
// roster, real start dates, real prior employers — all belonging to a different
// company, all rendered with the same authority as the truth. Nothing downstream
// can catch it, because the enrichment blob is internally consistent. It just
// isn't about this company.
//
// The book makes this likely, not hypothetical. Danny backs pre-seed founders whose
// companies are named Peak, Gil, Jean, Hedge, Prizm, Merlon, Full. Search "Peak
// linkedin company" and LinkedIn has dozens. A resolver that returns its top hit is
// a machine for attributing a 400-person company's headcount to a 3-person startup.
//
// So this refuses unless the evidence agrees with itself:
//   1. The URL is a real /company/ page — not a person, post, school, or job.
//   2. The page's name matches the company name we asked for (normalized), OR
//      the founder's own name appears on it. A slug that merely CONTAINS the query
//      is not a match: "peak" matches "peakon", "peak-support", "peak-design".
//   3. Anything ambiguous returns null WITH a reason, and the card stays honest —
//      an empty field says "unknown", which is true. A wrong one says something
//      false in a voice that sounds certain.
//
// Nothing here writes a signal or a claim. It writes one URL, or nothing.
// ══════════════════════════════════════════════════════════════════════════

const https = require('https');

const BAD_SLUGS = new Set([
  'company', 'school', 'showcase', 'jobs', 'login', 'signup', 'feed', 'pub', 'in',
]);

// Corporate suffixes and filler that shouldn't decide a match.
const NOISE = /\b(inc|llc|ltd|corp|corporation|co|company|technologies|technology|labs?|group|holdings|ai|io|hq|the)\b/g;

function norm(s) {
  return String(s || '')
    .toLowerCase()
    .normalize('NFKD').replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]+/g, ' ')
    .replace(NOISE, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/** The slug out of a LinkedIn company URL, or null if it isn't one. */
function companySlug(url) {
  const m = /linkedin\.com\/company\/([^/?#\s]+)/i.exec(String(url || ''));
  if (!m) return null;
  const slug = decodeURIComponent(m[1]).toLowerCase().replace(/\/$/, '');
  if (!slug || BAD_SLUGS.has(slug)) return null;
  return slug;
}

function canonicalUrl(slug) { return `https://www.linkedin.com/company/${slug}`; }

// ── The match test ──
// Equality after normalization, not inclusion. Inclusion is what turns "Peak" into
// "Peak Design". The one inclusion we allow is a multi-word company name whose full
// normalized form appears in the page title ("lume security" in "Lume Security |
// LinkedIn") — with >= 2 tokens the coincidence risk collapses.
function nameMatches(companyName, candidateText) {
  const want = norm(companyName);
  const got = norm(candidateText);
  if (!want || !got) return false;
  if (want === got) return true;

  const wantTokens = want.split(' ').filter(Boolean);

  // A ONE-WORD name must match the WHOLE candidate, nothing less.
  //
  // This started as `got.split(' ').includes(want)` — a token test — and its own
  // test caught it: "Peak" matched "Peak Design", "Jean" matched "Jean Paul
  // Gaultier". Token-containment is just substring-containment wearing a
  // disguise, and it's the exact way a 400-person company's roster ends up on a
  // 3-person card. If the page is really Danny's Peak, its name is "Peak".
  if (wantTokens.length === 1) return false;

  // Two or more tokens: containment is safe enough. "Lume Security" inside
  // "Lume Security | LinkedIn" is not a coincidence; one word can be.
  return got.includes(want);
}

function httpPost(host, path, headers, body) {
  return new Promise((resolve, reject) => {
    const data = JSON.stringify(body);
    const req = https.request(
      { hostname: host, path, method: 'POST', headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(data), ...headers } },
      (res) => {
        let buf = '';
        res.on('data', (c) => (buf += c));
        res.on('end', () => {
          try { resolve({ status: res.statusCode, data: JSON.parse(buf) }); }
          catch { resolve({ status: res.statusCode, data: {} }); }
        });
      }
    );
    req.on('error', reject);
    req.write(data);
    req.end();
  });
}

/**
 * @returns {Promise<{url:string|null, reason:string, candidates?:string[]}>}
 *   `url` is null unless the evidence agrees. `reason` always explains which.
 */
async function resolveCompanyLinkedIn({ company, founderName, website, exaKey, deps = {} }) {
  const post = deps.post || httpPost;
  const name = String(company || '').trim();

  if (!name) return { url: null, reason: 'no company name' };
  // "Stealth" is not a company. Searching it returns whichever startup last
  // branded itself that, and every stealth card would enrich as the same firm.
  if (/^stealth/i.test(norm(name))) return { url: null, reason: 'stealth — no company to resolve' };
  if (!exaKey) return { url: null, reason: 'no Exa key' };

  // Bias the query toward the actual page. The founder's name is the strongest
  // disambiguator available for a 3-person company nobody has written about.
  const q = [
    `${name} company linkedin`,
    founderName ? `${founderName}` : '',
    website ? website.replace(/^https?:\/\//, '') : '',
  ].filter(Boolean).join(' ');

  let resp;
  try {
    resp = await post('api.exa.ai', '/search', { 'x-api-key': exaKey }, {
      query: q,
      type: 'auto',
      num_results: 10,
      include_domains: ['linkedin.com'],
    });
  } catch (e) {
    return { url: null, reason: `exa error: ${e.message}` };
  }
  if (resp.status !== 200) return { url: null, reason: `exa HTTP ${resp.status}` };

  const results = (resp.data && resp.data.results) || [];
  const seen = new Map();
  for (const r of results) {
    const slug = companySlug(r.url);
    if (!slug) continue; // person profiles, posts, schools, jobs
    if (!seen.has(slug)) seen.set(slug, r);
  }
  if (!seen.size) return { url: null, reason: 'no LinkedIn company page in results' };

  // A candidate is confirmed by its own text, not by its rank.
  //
  // ── ONE-WORD NAMES NEED A SECOND WITNESS ──
  // Refusing when several candidates match (below) catches ambiguity we can SEE.
  // It cannot catch the worse case: Exa returns exactly one page, its name matches,
  // and it's the wrong company. Live run, 2026-07-16: "Ampere" matched the page
  // titled "Ampere" — slug `amperetech`. Danny's Ampere is a pre-seed startup;
  // Ampere Computing is a chip company with thousands of staff. One candidate, name
  // matches, completely wrong, and no downstream check could ever notice.
  //
  // A multi-word name ("Brae Systems", "Avant Health") is its own witness — the
  // collision risk is negligible. A single word is not. So for one-word names we
  // require corroboration that ties the page to THIS company: the founder's name on
  // it, or its own website domain. No witness, no URL.
  // Counted on the RAW name, not the normalized one — this is a distinctiveness
  // test, and norm() strips exactly the words that make a name look short.
  // "Auvi Labs" and "Diopter AI" normalize to one token ("labs"/"ai" are noise for
  // COMPARING names) and were being refused as one-word names, which they aren't.
  // The Ampere problem is names that are genuinely a single common word; "Auvi
  // Labs" carries two, and the second one still narrows the search space.
  const singleWord = String(name).trim().split(/[^A-Za-z0-9]+/).filter(Boolean).length === 1;
  const site = String(website || '').replace(/^https?:\/\//, '').replace(/^www\./, '').replace(/\/.*$/, '').toLowerCase();

  const confirmed = [];
  for (const [slug, r] of seen) {
    const text = `${r.title || ''} ${r.text || ''}`.slice(0, 2000);
    const bySlug = nameMatches(name, slug.replace(/-/g, ' '));
    const byTitle = nameMatches(name, (r.title || '').split('|')[0]);
    if (!bySlug && !byTitle) continue;

    // Corroboration. A founder's name is only meaningful if it's distinctive enough
    // not to collide by accident.
    const byFounder = !!(founderName && norm(founderName).length > 6 && norm(text).includes(norm(founderName)));
    const bySite = !!(site && site.length > 4 && text.toLowerCase().includes(site));
    const corroborated = byFounder || bySite;

    if (singleWord && !corroborated) {
      // Name matches, nothing else does. That is exactly the Ampere case.
      continue;
    }
    confirmed.push({ slug, strong: (bySlug && byTitle) || corroborated });
  }

  if (!confirmed.length) {
    return {
      url: null,
      reason: singleWord
        ? 'one-word name — no page both matched it and corroborated (founder or website)'
        : 'found LinkedIn pages, none whose name matches',
      candidates: [...seen.keys()].slice(0, 5),
    };
  }
  // Two different companies both plausibly named this. Guessing between them is
  // precisely the mistake this file exists to avoid.
  const distinct = [...new Set(confirmed.map((c) => c.slug))];
  if (distinct.length > 1) {
    const strong = confirmed.filter((c) => c.strong).map((c) => c.slug);
    const strongDistinct = [...new Set(strong)];
    if (strongDistinct.length !== 1) {
      return { url: null, reason: `ambiguous — ${distinct.length} company pages match that name`, candidates: distinct.slice(0, 5) };
    }
    return { url: canonicalUrl(strongDistinct[0]), reason: 'matched (disambiguated by founder/title)' };
  }

  return { url: canonicalUrl(distinct[0]), reason: 'matched' };
}

module.exports = { resolveCompanyLinkedIn, __test: { norm, companySlug, nameMatches, canonicalUrl } };
