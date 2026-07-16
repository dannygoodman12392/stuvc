'use strict';
// ══════════════════════════════════════════════════════════════════════════
// Are they hiring, and for what.
//
// Danny: "How many people/are they hiring and growing, what you could learn from
// the company site and crunchbase, etc..."
//
// company-enrich.js already answers "how many people" and "growing" — LinkedIn
// headcount plus the arrival curve. This is the other half, and at pre-seed it is
// the more interesting half, because WHAT they're hiring for is the roadmap
// stated in the only place a founder can't hedge it:
//
//   "Founding Engineer, Infra"           -> they're building, not selling yet
//   "Founding AE" / "GTM Lead"           -> they think the product is done enough
//   "Forward Deployed Engineer"          -> they have customers who need hand-holding
//   "Head of Ops" at six people          -> something is on fire
//
// A deck says "we're going to market in Q3". A job posting for a Founding AE, up
// eleven days ago, is them actually doing it. That delta is Danny's Q10 question
// — the one he says is his single best signal because it's the thing they can't
// perform — and here it's computable.
//
// ── THE RULE THAT SHAPES THIS FILE: NEVER SAY "NOT HIRING" ──
// Absence of a job board is not absence of hiring. Most of Danny's book is 4-person
// companies who hire through the founder's DMs and have no ATS at all. "No board
// found" means WE DON'T KNOW, and the card must say that.
//
// This isn't hypothetical caution — it's measured. Live 2026-07-16:
//
//   api.lever.co/v0/postings/plaid   -> 200 []
//   api.ashbyhq.com/…/job-board/plaid -> 200, 100+ open roles
//
// Plaid has a dormant Lever account and an active Ashby board. Guess "plaid" on
// Lever and you confidently report NOT HIRING about a company running a hundred
// open roles. A bogus slug 404s honestly; a STALE one returns a plausible empty
// list, and there is nothing in the response to tell them apart.
//
// So slugs are never guessed — they're discovered from the company's own careers
// page, which makes the slug evidence rather than a coincidence. The one exception
// is Greenhouse, which is the only one of the three that will tell you whose board
// it is (GET /v1/boards/anthropic -> {"name":"Anthropic"}), so a guess there can be
// corroborated by name. Ashby and Lever only echo the slug back, so they get no
// guessing at all.
// ══════════════════════════════════════════════════════════════════════════

const UA = 'Mozilla/5.0 (compatible; StuBot/1.0; +https://www.stu.vc)';
const TIMEOUT_MS = 12000;

// Paths worth trying when the homepage doesn't link anywhere useful. Ordered by
// hit rate on real startup sites.
//
// A 200 here does NOT mean the page exists. Framer, Webflow and Next SPAs answer
// 200 with a soft-404 for every path under the sun, so `${origin}/careers` comes
// back "fine" on sites that have no careers page at all. Anything guessed has to
// prove it's a careers page by looking like one — see LOOKS_LIKE_CAREERS.
const CAREERS_PATHS = ['/careers', '/jobs', '/company/careers', '/about/careers', '/company/jobs', '/careers/open-roles'];

// A careers page says one of these somewhere. A soft-404 of the marketing home
// page does not.
const LOOKS_LIKE_CAREERS = /open roles|open positions|join (?:our|the) team|we(?:'|’)?re hiring|current openings|view (?:all )?jobs|browse jobs|life at /i;

// Links on the homepage that point at a careers page. Discovered, not guessed —
// same principle as the slugs.
const CAREERS_LINK = /<a\b[^>]*href=["']([^"'#]+)["'][^>]*>((?:(?!<\/a>)[\s\S]){0,120})<\/a>/gi;
const CAREERS_WORD = /career|jobs?\b|open roles|hiring|join us|work with us/i;

// Verified live 2026-07-16 against ramp.com and linear.app, both of which expose
// their Ashby board in the page HTML.
const ATS_PATTERNS = [
  { ats: 'greenhouse', re: /(?:job-boards|boards)\.greenhouse\.io\/([a-z0-9_-]+)/i },
  { ats: 'lever', re: /jobs\.lever\.co\/([a-z0-9_-]+)/i },
  { ats: 'ashby', re: /jobs\.ashbyhq\.com\/([a-zA-Z0-9_-]+)/i },
];

// Slugs that are the ATS's own pages, not a customer's board.
const NOT_A_SLUG = new Set(['embed', 'api', 'www', 'jobs', 'careers', 'search', 'login', 'about', 'privacy', 'terms']);

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

/** The registrable label of a domain: "https://www.ramp.com/x" -> "ramp". */
function domainLabel(website) {
  const m = /^(?:https?:\/\/)?(?:www\.)?([^/?#:]+)/i.exec(String(website || '').trim());
  if (!m) return null;
  const host = m[1].toLowerCase();
  const parts = host.split('.').filter(Boolean);
  if (parts.length < 2) return null;
  return parts[0] === 'www' ? parts[1] : parts[0];
}

// ── Hosts that are somebody's PROFILE, not somebody's company ──
//
// Not hypothetical. Measured on PRODUCTION 2026-07-16 — 76 of 183 cards carry a
// website_url and the field holds whatever got pasted:
//
//   Permute            -> scout.space          <- a DIFFERENT portfolio company
//   Ampere             -> "N/A"
//   OpenMatter Network -> "https://openmatter.network https://zkfirewall.openmatter.network"
//
// The aggregator case (a founder's linkedin.com/in/... profile in the website field)
// is the one this list exists for: read it as a website and we'd crawl linkedin.com,
// find LinkedIn Corp's careers page, and hang THEIR job board off a 4-person card.
// The card would say 4 people; the board would say 20,000.
//
// An earlier version of this comment cited "LegalOS -> linkedin.com/in/matthew-asir"
// as live. That row exists only in the STALE LOCAL DB — there is no LegalOS card on
// production. The guard is right; the citation was measured against the wrong
// database. Every host below is one whose careers page belongs to the aggregator
// rather than to the company being aggregated.
//
// lib/ingest.js has a BLOCKED_HOSTS of its own, for a different reason (Exa gets a
// login wall). Same instinct, different failure — that one loses data, this one
// invents it.
const NOT_A_COMPANY_SITE = [
  /(^|\.)linkedin\.com$/i, /(^|\.)crunchbase\.com$/i, /(^|\.)angel\.co$/i,
  /(^|\.)wellfound\.com$/i, /(^|\.)x\.com$/i, /(^|\.)twitter\.com$/i,
  /(^|\.)github\.com$/i, /(^|\.)notion\.(so|site)$/i, /(^|\.)docsend\.com$/i,
  /(^|\.)medium\.com$/i, /(^|\.)substack\.com$/i, /(^|\.)ycombinator\.com$/i,
  /(^|\.)facebook\.com$/i, /(^|\.)instagram\.com$/i, /(^|\.)youtube\.com$/i,
];

function isCompanySite(website) {
  const o = originOf(website);
  if (!o) return false;
  try { return !NOT_A_COMPANY_SITE.some((re) => re.test(new URL(o).hostname)); } catch { return false; }
}

function originOf(website) {
  // Founders paste more than one URL into a single field — live on the board:
  // "https://openmatter.network https://zkfirewall.openmatter.network". Take the
  // first, which is the one they'd have led with.
  const s = String(website || '').trim().split(/\s+/)[0];
  if (!s) return null;
  const withProto = /^https?:\/\//i.test(s) ? s : `https://${s}`;
  try {
    const u = new URL(withProto);
    if (!/^https?:$/.test(u.protocol) || !u.hostname.includes('.')) return null;
    return u.origin;
  } catch { return null; }
}

// Global fetch, not the https module the rest of lib/ uses. Deliberate: this hits
// marketing sites, which means redirects (ramp.com -> www.ramp.com), gzip, and
// occasional junk encodings. fetch handles all three; hand-rolling them again here
// would be a worse version of what Node already ships. Every call is injectable
// anyway, so the tests never touch the network.
async function httpGet(url) {
  try {
    const ctl = new AbortController();
    const t = setTimeout(() => ctl.abort(), TIMEOUT_MS);
    const res = await fetch(url, { headers: { 'User-Agent': UA }, redirect: 'follow', signal: ctl.signal });
    clearTimeout(t);
    const body = await res.text();
    return { status: res.status, body };
  } catch {
    return { status: 0, body: '' };
  }
}

// ── Finding the board ──

/** Careers links the homepage actually points at, absolutised against origin. */
function findCareersLinks(htmlBody, origin) {
  const out = [];
  const re = new RegExp(CAREERS_LINK.source, 'gi');
  let m;
  while ((m = re.exec(String(htmlBody || '')))) {
    const href = m[1].trim();
    const text = m[2].replace(/<[^>]+>/g, ' ').trim();
    if (!CAREERS_WORD.test(href) && !CAREERS_WORD.test(text)) continue;
    let abs;
    try { abs = new URL(href, origin).toString(); } catch { continue; }
    // Only their own site. A footer link to linkedin.com/jobs is not their careers
    // page, and following it would read someone else's board.
    try { if (new URL(abs).origin !== origin) continue; } catch { continue; }
    if (!out.includes(abs)) out.push(abs);
  }
  return out.slice(0, 4);
}

/** Every ATS reference in a blob of HTML. */
function findAts(htmlBody) {
  const out = [];
  for (const { ats, re } of ATS_PATTERNS) {
    const g = new RegExp(re.source, 'gi');
    let m;
    while ((m = g.exec(String(htmlBody || '')))) {
      const slug = m[1];
      if (!slug || NOT_A_SLUG.has(slug.toLowerCase())) continue;
      if (!out.some((o) => o.ats === ats && o.slug === slug)) out.push({ ats, slug });
    }
  }
  return out;
}

// ── Reading the board ──
// Three shapes, all verified live 2026-07-16:
//   greenhouse boards-api.greenhouse.io/v1/boards/<slug>/jobs -> {jobs:[{title,location:{name},updated_at,absolute_url}]}
//   lever      api.lever.co/v0/postings/<slug>?mode=json      -> [{text,categories:{team,location,commitment},createdAt,hostedUrl}]
//   ashby      api.ashbyhq.com/posting-api/job-board/<slug>   -> {jobs:[{title,department,location,isRemote,publishedAt,jobUrl}]}

const BOARDS = {
  greenhouse: {
    jobsUrl: (slug) => `https://boards-api.greenhouse.io/v1/boards/${encodeURIComponent(slug)}/jobs`,
    boardUrl: (slug) => `https://job-boards.greenhouse.io/${slug}`,
    parse: (d) => (d?.jobs || []).map((j) => ({
      title: String(j.title || '').trim(),
      location: j.location?.name || null,
      team: null,
      remote: /remote/i.test(j.location?.name || ''),
      posted: j.first_published || j.updated_at || null,
      url: j.absolute_url || null,
    })),
  },
  lever: {
    jobsUrl: (slug) => `https://api.lever.co/v0/postings/${encodeURIComponent(slug)}?mode=json`,
    boardUrl: (slug) => `https://jobs.lever.co/${slug}`,
    parse: (d) => (Array.isArray(d) ? d : []).map((j) => ({
      title: String(j.text || '').trim(),
      location: j.categories?.location || null,
      team: j.categories?.team || null,
      remote: /remote/i.test(j.workplaceType || j.categories?.location || ''),
      // Lever ships epoch millis, everyone else ships ISO. Normalise here so the
      // card never has to know which board a role came from.
      posted: j.createdAt ? new Date(Number(j.createdAt)).toISOString() : null,
      url: j.hostedUrl || null,
    })),
  },
  ashby: {
    jobsUrl: (slug) => `https://api.ashbyhq.com/posting-api/job-board/${encodeURIComponent(slug)}`,
    boardUrl: (slug) => `https://jobs.ashbyhq.com/${slug}`,
    parse: (d) => (d?.jobs || []).filter((j) => j.isListed !== false).map((j) => ({
      title: String(j.title || '').trim(),
      location: j.location || null,
      team: j.department || j.team || null,
      remote: Boolean(j.isRemote),
      posted: j.publishedAt || null,
      url: j.jobUrl || null,
    })),
  },
};

async function readBoard({ ats, slug, deps = {} }) {
  const get = deps.get || httpGet;
  const spec = BOARDS[ats];
  if (!spec) return null;
  const { status, body } = await get(spec.jobsUrl(slug));
  // 404 is a clean "this slug isn't a board" and is the only honest negative any
  // of these three give us.
  if (status !== 200 || !body) return null;
  let d;
  try { d = JSON.parse(body); } catch { return null; }
  if (d && d.ok === false) return null;
  return spec.parse(d).filter((r) => r.title);
}

/** Greenhouse is the only board that will say whose it is. */
async function greenhouseBoardName({ slug, deps = {} }) {
  const get = deps.get || httpGet;
  const { status, body } = await get(`https://boards-api.greenhouse.io/v1/boards/${encodeURIComponent(slug)}`);
  if (status !== 200 || !body) return null;
  try { return JSON.parse(body)?.name || null; } catch { return null; }
}

// ── The read ──

// Roles that tell you the company changed shape. Matched against the title, and
// deliberately narrow: a list that flags everything flags nothing.
const ROLE_TELLS = [
  { re: /\bfounding\s+(engineer|ai engineer|designer)\b/i, means: 'still building the thing' },
  { re: /\bfounding\s+(ae|account executive|gtm|sales)\b/i, means: 'first real go-to-market hire' },
  { re: /\b(forward.deployed|solutions engineer|implementation)\b/i, means: 'customers exist and need hand-holding' },
  { re: /\b(head|vp|director) of (sales|revenue|marketing|growth)\b/i, means: 'building a sales motion' },
  { re: /\b(recruiter|talent|people ops|chief of staff)\b/i, means: 'hiring to hire — usually just funded' },
];

function readTells(roles) {
  const out = [];
  for (const t of ROLE_TELLS) {
    const hit = roles.find((r) => t.re.test(r.title));
    if (hit) out.push({ role: hit.title, means: t.means });
  }
  return out;
}

/**
 * @returns {Promise<{found:boolean, reason:string, confidence?:'linked'|'name-verified',
 *   ats?:string, board_url?:string, role_count?:number, roles?:Array, tells?:Array,
 *   careers_url?:string|null, fetched_at?:string}>}
 *
 * `found:false` never means "not hiring". It means no board was found, which for a
 * five-person company is the normal case and not a fact about their hiring.
 */
async function hiringFor({ company, website, deps = {} }) {
  const get = deps.get || httpGet;
  const origin = originOf(website);
  if (!origin) return { found: false, reason: 'no website on the card — nothing to read' };
  if (!isCompanySite(website)) {
    // Say which field is wrong and what it should hold. An unexplained empty block
    // is how a feature gets abandoned; this one is a 10-second fix if Danny knows.
    let host = origin;
    try { host = new URL(origin).hostname; } catch { /* keep the origin */ }
    return {
      found: false,
      reason: `the website field points at ${host}, which is a profile rather than the company's own site — reading it would report ${host}'s open roles as theirs`,
    };
  }

  // 1. Ask the company's own site where its board is. A link from their careers
  //    page is evidence; a slug we invented is a coincidence waiting to happen.
  let careersUrl = null;
  const seen = [];
  const addAts = (body) => {
    for (const h of findAts(body)) {
      if (!seen.some((s) => s.ats === h.ats && s.slug === h.slug)) seen.push(h);
    }
  };

  const home = await get(origin);
  const homeBody = home.status === 200 ? home.body || '' : '';
  addAts(homeBody);

  if (!seen.length) {
    // Follow the careers link they actually published, then fall back to guessing
    // paths. A guessed path must LOOK like a careers page before we believe it —
    // an SPA answers 200 for everything, so status alone proves nothing.
    const linked = findCareersLinks(homeBody, origin);
    const guessed = CAREERS_PATHS.map((p) => `${origin}${p}`).filter((u) => !linked.includes(u));

    for (const url of [...linked, ...guessed]) {
      const { status, body } = await get(url);
      if (status !== 200 || !body) continue;

      const isLinked = linked.includes(url);
      // The homepage served back under another path is the classic soft-404.
      const isEcho = homeBody && body.length === homeBody.length && body === homeBody;
      if (!careersUrl && !isEcho && (isLinked || LOOKS_LIKE_CAREERS.test(body))) careersUrl = url;

      addAts(body);
      if (seen.length) break;   // The first page that names a board is enough.
    }
  }

  for (const { ats, slug } of seen) {
    const roles = await readBoard({ ats, slug, deps });
    if (!roles) continue;
    return ok({ ats, slug, roles, confidence: 'linked', reason: `${origin} links to its ${ats} board`, careersUrl });
  }

  // 2. Nothing linked. Greenhouse is the only board we can safely guess at, because
  //    it's the only one that will confirm the company's name back to us.
  const label = domainLabel(website);
  if (label && company) {
    const name = await greenhouseBoardName({ slug: label, deps });
    if (name && norm(name) === norm(company)) {
      const roles = await readBoard({ ats: 'greenhouse', slug: label, deps });
      if (roles) {
        return ok({ ats: 'greenhouse', slug: label, roles, confidence: 'name-verified', reason: `Greenhouse board "${name}" matches the company name`, careersUrl });
      }
    }
  }

  return {
    found: false,
    // Say the true thing. "No job board" is not "not hiring", and at pre-seed it is
    // overwhelmingly the normal state.
    reason: careersUrl
      ? 'they have a careers page but no job board we can read — roles may be listed on the page itself'
      : 'no job board found — most pre-seed companies hire without one, so this says nothing about whether they’re hiring',
    careers_url: careersUrl,
    fetched_at: new Date().toISOString(),
  };

  function ok({ ats, slug, roles, confidence, reason, careersUrl: cu }) {
    const posted = roles.map((r) => r.posted).filter(Boolean).sort();
    return {
      found: true,
      reason,
      confidence,
      ats,
      slug,
      board_url: BOARDS[ats].boardUrl(slug),
      role_count: roles.length,
      // Newest first — "what did they open most recently" is the live question.
      roles: roles.sort((a, b) => String(b.posted || '').localeCompare(String(a.posted || ''))),
      tells: readTells(roles),
      newest_post: posted.length ? posted[posted.length - 1] : null,
      careers_url: cu,
      fetched_at: new Date().toISOString(),
    };
  }
}

module.exports = { hiringFor, findAts, readBoard, domainLabel, originOf, isCompanySite, readTells, BOARDS, norm };
