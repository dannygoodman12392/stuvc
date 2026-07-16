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

// ══════════════════════════════════════════════════════════════════════════
// STRATEGY ZERO: ASK THE DOMAIN.
//
// Everything below this line is a search — guess a page, then interrogate it, then
// usually refuse. It works, and its refusals are correct, but they are refusals:
// dry run against production 2026-07-16, 93 cards considered, **0 resolved**, 39
// stuck on "one-word name — no page both matched it and corroborated". Ampere,
// Albacore, Addictd, Aganomix. The guard was doing its job and the feature was
// still worth nothing.
//
// A DOMAIN is not a guess. EnrichLayer resolves one directly:
//
//   GET /api/v2/company/resolve?company_domain=auvilabs.com
//     -> {"url": "https://www.linkedin.com/company/auvilabs"}
//
// Verified live against three real pre-seed companies off Danny's board
// (concordahq.com, hydrastack.io, inferadb.com) — all three correct, ~1.3 credits
// each. These are 4-person companies the name search refuses to touch.
//
// ── WHY THIS IS SAFE WHEN THE SEARCH ISN'T ──
// The domain comes off Danny's own card. If he typed the company's website, the
// domain IS the company — there's no inference left to get wrong. The whole
// paranoia below exists because "Peak" could be anyone; peak.com could not.
//
// Measured failure modes, all handled:
//   zzzzz-not-real.com -> {"url": null}      honest refusal, no guessing
//   linkedin.com       -> company/linkedin   <- THE ONE THAT BITES
//   gmail.com          -> company/gmail-it-ltd
//
// The website field holds whatever got pasted. Measured on PRODUCTION 2026-07-16:
// Permute's is `scout.space` (a DIFFERENT portfolio company), Ampere's is the literal
// string "N/A", OpenMatter's is two URLs in one field. Pass an aggregator URL through
// and a 4-person card fills with that aggregator's roster. So the same guard
// lib/hiring.js uses gates this — a website field that isn't a company's own site is
// not a domain, it's a mistake.
const { isCompanySite, originOf } = require('./hiring');

function domainOf(website) {
  const o = originOf(website);
  if (!o) return null;
  try { return new URL(o).hostname.replace(/^www\./i, ''); } catch { return null; }
}

async function resolveByDomain({ website, key, deps = {} }) {
  const getJson = deps.getJson || httpGetJson;
  if (!key) return { url: null, reason: 'no EnrichLayer key' };
  if (!website) return { url: null, reason: 'no website on the card' };

  // Order matters, and getting it wrong produces a reason that lies. isCompanySite()
  // is false for an aggregator AND for a string that isn't a domain at all, so
  // checking it first reported the live value "tbd" as "points at an aggregator" —
  // nonsense to anyone reading it, and the fix for the two cases is different (one
  // is a wrong URL, the other is an empty field with a word in it).
  const domain = domainOf(website);
  if (!domain) return { url: null, reason: `"${String(website).slice(0, 40)}" is not a domain` };
  if (!isCompanySite(website)) {
    return { url: null, reason: `the website field points at ${domain}, which is a profile rather than the company's own site` };
  }

  const r = await getJson(`/api/v2/company/resolve?company_domain=${encodeURIComponent(domain)}`, key);
  if (r.status !== 200) return { url: null, reason: `EnrichLayer HTTP ${r.status}` };
  const url = r.data && r.data.url;
  // `{"url": null}` is EnrichLayer saying it doesn't know. That's the honest answer
  // for a startup with no LinkedIn page, and it must not fall through to a guess.
  if (!url) return { url: null, reason: `no LinkedIn page for ${domain}` };
  const slug = companySlug(url);
  if (!slug) return { url: null, reason: `EnrichLayer returned a non-company URL: ${url}` };
  return { url: canonicalUrl(slug), reason: `resolved from ${domain}` };
}

function httpGetJson(path, key) {
  return new Promise((resolve) => {
    const req = https.get(
      { hostname: 'enrichlayer.com', path, headers: { Authorization: `Bearer ${key}` } },
      (res) => {
        let b = '';
        res.on('data', (c) => (b += c));
        res.on('end', () => { try { resolve({ status: res.statusCode, data: JSON.parse(b) }); } catch { resolve({ status: res.statusCode, data: null }); } });
      }
    );
    req.on('error', () => resolve({ status: 0, data: null }));
    req.setTimeout(20000, () => { req.destroy(); resolve({ status: 0, data: null }); });
  });
}

/**
 * @returns {Promise<{url:string|null, reason:string, candidates?:string[]}>}
 *   `url` is null unless the evidence agrees. `reason` always explains which.
 */
async function resolveCompanyLinkedIn({ company, founderName, website, exaKey, enrichKey, deps = {} }) {
  const post = deps.post || httpPost;
  const name = String(company || '').trim();

  if (!name) return { url: null, reason: 'no company name' };

  // Ask the domain first. It's cheaper than being clever and it's the only path here
  // that isn't an inference.
  if (website && enrichKey) {
    const byDomain = await resolveByDomain({ website, key: enrichKey, deps });
    if (byDomain.url) return byDomain;
    // Fall through to the search — a company with no LinkedIn page under its domain
    // may still have one under a former name.
  }
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

module.exports = { resolveCompanyLinkedIn, resolveByDomain, __test: { norm, companySlug, nameMatches, canonicalUrl, domainOf } };
