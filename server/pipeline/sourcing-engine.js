/**
 * Superior Studios — Founder Sourcing Engine v2
 * ================================================
 * Daily-recurring discovery engine that finds the best pre-seed builders
 * with Chicago/Illinois ties using Exa AI semantic search + Claude scoring.
 *
 * Sources:
 *   1. Exa AI — semantic web search across 40+ proven query vectors
 *   2. GitHub API — Chicago-based technical founders
 *
 * Enrichment:
 *   - EnrichLayer — LinkedIn profile enrichment for top scorers (8+)
 *
 * Scoring:
 *   - Claude — geography-weighted 1-10 fit score with structured signals
 */

const db = require('../db');
const https = require('https');

// ── API Clients ──

function getAnthropicClient() {
  try {
    const apiKey = process.env.ANTHROPIC_API_KEY;
    if (!apiKey) return null;
    const Anthropic = require('@anthropic-ai/sdk');
    return new Anthropic({ apiKey });
  } catch {
    return null;
  }
}

function httpPost(url, headers, body) {
  return new Promise((resolve, reject) => {
    const parsed = new URL(url);
    const data = JSON.stringify(body);
    const req = https.request({
      hostname: parsed.hostname,
      path: parsed.pathname + parsed.search,
      method: 'POST',
      headers: { ...headers, 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(data) },
    }, (res) => {
      let result = '';
      res.on('data', chunk => result += chunk);
      res.on('end', () => {
        try { resolve({ status: res.statusCode, data: JSON.parse(result) }); }
        catch { resolve({ status: res.statusCode, data: result }); }
      });
    });
    req.on('error', reject);
    req.write(data);
    req.end();
  });
}

function httpGet(url, headers) {
  return new Promise((resolve, reject) => {
    const parsed = new URL(url);
    const req = https.get({
      hostname: parsed.hostname,
      path: parsed.pathname + parsed.search,
      headers,
    }, (res) => {
      let result = '';
      res.on('data', chunk => result += chunk);
      res.on('end', () => {
        try { resolve({ status: res.statusCode, data: JSON.parse(result) }); }
        catch { resolve({ status: res.statusCode, data: result }); }
      });
    });
    req.on('error', reject);
  });
}

// ── Illinois Verification (ported from Claude Funnel v3) ──

const ILLINOIS_LOCATIONS = [
  'chicago', 'evanston', 'naperville', 'aurora', 'joliet', 'rockford',
  'schaumburg', 'palatine', 'skokie', 'oak park', 'wicker park',
  'lincoln park', 'river north', 'west loop', 'south loop', 'pilsen',
  'logan square', 'downers grove', 'elmhurst', 'wheaton', 'lombard',
  'urbana', 'champaign', 'peoria', 'springfield', 'bloomington',
  'northbrook', 'highland park', 'lake forest', 'winnetka', 'wilmette',
  'oak brook', 'lisle', 'bolingbrook', 'orland park', 'tinley park',
  'illinois', 'chicagoland'
];

const ILLINOIS_SCHOOLS = [
  'university of illinois', 'uiuc', 'illinois institute of technology',
  'iit', 'northwestern university', 'northwestern', 'kellogg',
  'university of chicago', 'uchicago', 'chicago booth', 'loyola chicago',
  'depaul university', 'illinois state', 'southern illinois'
];

const ELITE_SCHOOLS = [
  'stanford', 'harvard', 'mit', 'uc berkeley', 'university of michigan',
  'carnegie mellon', 'caltech', 'princeton', 'yale', 'columbia',
  'university of pennsylvania', 'wharton', 'cornell'
];

const HYPERSCALE_COMPANIES = [
  'google', 'meta', 'facebook', 'apple', 'amazon', 'microsoft', 'netflix',
  'stripe', 'openai', 'anthropic', 'palantir', 'anduril', 'spacex',
  'coinbase', 'datadog', 'snowflake', 'databricks', 'figma', 'notion',
  'linear', 'vercel', 'supabase', 'plaid', 'robinhood', 'citadel',
  'jump trading', 'drw', 'two sigma', 'jane street', 'tempus',
  'grubhub', 'groupon', 'avant', 'braintree', 'paypal'
];

// R1: Elite national schools are a PEDIGREE signal, NEVER a standalone IL tie.
// Tie must come from: (a) current location, (b) strict work-context, (c) Illinois school,
// (d) grew up / from / raised in IL, (e) worked at Chicago-HQ company.
function verifyIllinois(text, headline) {
  const combined = ((headline || '') + ' ' + (text || '')).toLowerCase();

  // (a) Current location — "City, Illinois" or "City, IL" patterns
  for (const loc of ILLINOIS_LOCATIONS) {
    if (combined.includes(`${loc}, illinois`) || combined.includes(`${loc}, il`)) {
      return { verified: true, type: 'current', location: loc.charAt(0).toUpperCase() + loc.slice(1) };
    }
  }
  if (combined.includes('greater chicago area') || combined.includes('chicagoland') || combined.includes('chicago metropolitan')) {
    return { verified: true, type: 'current', location: 'Chicago Area' };
  }

  // (b) Work context — tighter regex with explicit work verbs
  const workPatterns = [
    /\bbased in (chicago|illinois|evanston|greater chicago)/,
    /\blocated in (chicago|illinois)/,
    /\b(currently|now) (building|working|living) (in|out of) (chicago|illinois)/,
    /\b(moved|relocated|moving)\s+(to\s+)?chicago/,
    /\b(founder|ceo|cto|cofounder|co-founder|engineer)\s+(at|@|in|of)\s+[a-z0-9\s]{0,40}(chicago|illinois|evanston)/,
  ];
  for (const p of workPatterns) {
    if (p.test(combined)) return { verified: true, type: 'working', location: 'Chicago' };
  }

  // (c) Illinois school alumni — local-anchor schools satisfy both tie + pedigree per ICP
  for (const school of ILLINOIS_SCHOOLS) {
    if (combined.includes(school)) {
      return { verified: true, type: 'school_alumni', location: school.split(' ').map(w => w.charAt(0).toUpperCase() + w.slice(1)).join(' ') };
    }
  }

  // (d) Hometown / grew up in IL
  const hometownPatterns = [
    /\b(from|grew up in|born in|raised in|native of)\s+(chicago|illinois|evanston|naperville|oak park)/,
    /\b(chicago|illinois)\s+(native|local|born)/,
  ];
  for (const p of hometownPatterns) {
    if (p.test(combined)) return { verified: true, type: 'hometown', location: 'Illinois (hometown)' };
  }

  // (e) Worked at Chicago-HQ company (strict: company name + Chicago office context)
  const chicagoHqCompanies = ['grubhub', 'groupon', 'avant', 'braintree', 'tempus', 'sprout social', 'cameo', 'outcome health'];
  for (const co of chicagoHqCompanies) {
    if (combined.includes(co) && (combined.includes('chicago') || combined.includes('illinois'))) {
      return { verified: true, type: 'chicago_company', location: `Ex-${co.charAt(0).toUpperCase() + co.slice(1)}` };
    }
  }

  // NOTE: Elite-school-only path intentionally removed — see R1 of sourcing audit.
  // National elite schools (Stanford, Harvard, MIT, etc.) are pedigree multipliers,
  // NEVER a standalone IL tie. They must pair with one of the above tie types.
  return { verified: false, type: null, location: null };
}

// ── Generic Location Verification (uses user's target locations) ──

// R1: Tie verification — elite schools never establish tie on their own.
// Tie requires one of:
//   (a) location keyword in structured form (", IL" / ", Illinois" / "based in")
//   (b) user-target school attendance
//   (c) hometown / grew up in target location
//   (d) worked at target-location-HQ company with location context
// Raw substring match on a user location is rejected unless it has structural
// context (comma pattern, "based in", etc.) — too many false positives like
// "Chicago Bears fan" or "Illinois tax law".
function verifyLocation(text, headline, criteria) {
  const combined = ((headline || '') + ' ' + (text || '')).toLowerCase();
  const userLocations = (criteria.locations || []).map(l => l.toLowerCase());
  const userSchools = (criteria.schools || []).map(s => s.toLowerCase());

  // No location preference → everyone passes (intentional — broad search mode)
  if (userLocations.length === 0 && userSchools.length === 0) {
    return { verified: true, type: 'broad', location: 'Any' };
  }

  // (a) Structured current-location mention of user's target locations
  for (const loc of userLocations) {
    // "chicago, il" / "chicago, illinois" / "based in chicago" / "located in chicago"
    const patterns = [
      new RegExp(`\\b${loc.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\s*,\\s*(il\\b|illinois\\b)`, 'i'),
      new RegExp(`\\bbased in\\s+${loc.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}`, 'i'),
      new RegExp(`\\blocated in\\s+${loc.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}`, 'i'),
      new RegExp(`\\bgreater\\s+${loc.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\s+area\\b`, 'i'),
      new RegExp(`\\b${loc.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\s+(metropolitan|area|metro)\\b`, 'i'),
    ];
    if (patterns.some(p => p.test(combined))) {
      return { verified: true, type: 'current', location: loc.charAt(0).toUpperCase() + loc.slice(1) };
    }
    // Work-role + location co-occurrence (stricter than previous 40-char window)
    const workRole = new RegExp(`\\b(founder|ceo|cto|cofounder|co-founder|head of|vp of|director of)\\b[^.]{0,30}\\b${loc.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`, 'i');
    if (workRole.test(combined)) {
      return { verified: true, type: 'working', location: loc.charAt(0).toUpperCase() + loc.slice(1) };
    }
  }

  // (b) User-target school attendance
  for (const school of userSchools) {
    if (combined.includes(school)) {
      return { verified: true, type: 'school_alumni', location: school.split(' ').map(w => w.charAt(0).toUpperCase() + w.slice(1)).join(' ') };
    }
  }

  // (c) Hometown / from-ties to target location
  for (const loc of userLocations) {
    const hometown = new RegExp(`\\b(from|grew up in|born in|raised in|native of)\\s+${loc.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`, 'i');
    const nativeOf = new RegExp(`\\b${loc.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\s+(native|local|born)\\b`, 'i');
    if (hometown.test(combined) || nativeOf.test(combined)) {
      return { verified: true, type: 'hometown', location: `${loc.charAt(0).toUpperCase() + loc.slice(1)} (hometown)` };
    }
  }

  // NOTE: Elite-school-only path intentionally removed — see R1 of sourcing audit.
  // National elite schools are pedigree, not location ties.
  return { verified: false, type: null, location: null };
}

function extractSignals(text, headline) {
  const combined = ((headline || '') + ' ' + (text || '')).toLowerCase();
  const pedigree = [];
  const builder = [];
  // R10: separate tiers — anchor schools (IL tie + pedigree) vs national elites (pedigree only)
  const anchorSchoolsIl = [];
  const eliteSchoolsNational = [];

  for (const school of ILLINOIS_SCHOOLS) {
    if (combined.includes(school)) {
      const display = school.split(' ').map(w => w.charAt(0).toUpperCase() + w.slice(1)).join(' ');
      pedigree.push(display);
      anchorSchoolsIl.push(display);
    }
  }
  for (const school of ELITE_SCHOOLS) {
    if (combined.includes(school)) {
      const display = school.split(' ').map(w => w.charAt(0).toUpperCase() + w.slice(1)).join(' ');
      pedigree.push(display);
      eliteSchoolsNational.push(display);
    }
  }

  // Hyperscale pedigree
  for (const company of HYPERSCALE_COMPANIES) {
    if (combined.includes(company)) {
      pedigree.push('Ex-' + company.split(' ').map(w => w.charAt(0).toUpperCase() + w.slice(1)).join(' '));
    }
  }

  // Builder signals
  if (/y combinator|yc\s|ycombinator/.test(combined)) builder.push('YC Alum');
  if (/techstars/.test(combined)) builder.push('Techstars');
  if (/south park commons/.test(combined)) builder.push('SPC');
  if (/\b(exited|acquired|sold|exit)\b/.test(combined)) builder.push('Previous Exit');
  if (/serial (founder|entrepreneur)/.test(combined)) builder.push('Serial Founder');
  if (/second.time (founder|entrepreneur)/.test(combined)) builder.push('Second-time Founder');
  if (/co.?found/.test(combined)) builder.push('Co-founder');
  if (/open.source/.test(combined)) builder.push('Open Source');
  if (/ph\.?d/.test(combined)) builder.push('PhD');
  if (/patent/.test(combined)) builder.push('Patent Holder');

  // Stealth / early-stage signals (high-value — these are our ideal candidates)
  if (/stealth/.test(combined)) builder.push('Stealth Mode');
  if (/building something new/.test(combined)) builder.push('Building Something New');
  if (/exploring what['']?s next/.test(combined)) builder.push('Exploring Next');
  if (/\bjust left\b/.test(combined)) builder.push('Just Left Role');
  if (/\bpre.?launch\b/.test(combined)) builder.push('Pre-launch');
  if (/\bpre.?seed\b/.test(combined)) builder.push('Pre-seed');
  if (/\bday (one|1|zero|0)\b/.test(combined)) builder.push('Day One');
  if (/\bin stealth\b/.test(combined)) builder.push('Stealth Mode');
  if (/working on something new/.test(combined)) builder.push('Building Something New');
  if (/\bformer (cto|ceo|vp|head of)\b/.test(combined)) builder.push('Former Executive');
  if (/\b(next chapter|what['']?s next|new venture)\b/.test(combined)) builder.push('Starting New Venture');

  return {
    pedigree: [...new Set(pedigree)],
    builder: [...new Set(builder)],
    anchor_schools_il: [...new Set(anchorSchoolsIl)],
    elite_schools_national: [...new Set(eliteSchoolsNational)],
  };
}

// ── R6: Stage Pre-filter — body text + seniority + funding patterns ──
// Returns { disqualified: bool, reason: string | null }
// Disqualifies candidates whose own company is clearly past pre-seed.
// Prior version only checked headline for "IPO/unicorn/500+ employees" — caught ~5%.
// This version scans body for funding-round language + named top-tier investors
// bounded to the candidate's OWN company (heuristic: "raised by X", "our Series B",
// "we raised", or funding language within 80 chars of a first-person signal).
function isTooFarAlong(text, headline) {
  const h = (headline || '').toLowerCase();
  const t = (text || '').toLowerCase();

  // HEADLINE disqualifiers — strong, unambiguous
  const headlinePatterns = [
    { p: /\bipo\b/, reason: 'IPO in headline' },
    { p: /\bunicorn\b/, reason: 'Unicorn in headline' },
    { p: /\b\d{3,}\+?\s*employees\b/, reason: 'Headcount in headline' },
    { p: /\bceo\s+(of|@)\s+.{1,50}(public|nasdaq|nyse)/i, reason: 'CEO of public co' },
    { p: /\bpost[- ]ipo\b/, reason: 'Post-IPO' },
    { p: /\bseries\s+[b-z]\b/i, reason: 'Series B+ in headline' },
  ];
  for (const { p, reason } of headlinePatterns) {
    if (p.test(h)) return { disqualified: true, reason };
  }

  // BODY disqualifiers — need to distinguish "our Series B" (disqualify) from
  // "previously at a Series B startup" (past employer, pass).
  // Present-tense self-reference = strong signal. Past-tense or "previously/ex-/former"
  // near the funding signal negates the disqualification.
  const presentSelfRef = new RegExp([
    "\\bwe(['’]re| are| have| just| recently| raised| closed| launched| are building)\\b",
    "\\bour (current |company|startup|co|seed|series|round|funding|team)\\b",
    "\\bi (just |recently |have )?(raised|closed|launched|incorporated|founded|am building|am raising|led|lead)\\b",
    "\\bmy (company|startup|co|business|venture|new)\\b",
    "\\bthe company (has|is|just|raised|we|our)\\b",
    "\\bhere at\\b",
    "\\bfounder of\\b",
    "\\b(ceo|cto|coo) of\\b",
  ].join("|"), "i");
  const pastEmployerSignal = /\b(previously|formerly|ex-|former|prior to|used to|was at|was a|joined\s+\w+\s+as|worked at|worked for|during my time|left\s+to|before (starting|founding|co-founding)|back when|while at|stint at)\b/i;

  const bodyFundingPatterns = [
    { p: /\bseries\s+[b-z]\b/i, reason: 'Series B+ in body (own co)' },
    { p: /\braised\s+\$\s?\d+(\.\d+)?\s*[mb]\b/i, reason: 'Raised $N[mb] (own co)' },
    { p: /\$\d+(\.\d+)?\s*[mb]\s+(seed|round|raise|funding)\b/i, reason: 'Funding round amount (own co)' },
    { p: /\bfunding\s+led\s+by\s+(sequoia|a16z|andreessen|benchmark|accel|greylock|founders fund|khosla|redpoint|nea|lightspeed|insight|general catalyst|thrive|spark|ribbit|iconiq)/i, reason: 'Named tier-1 lead' },
    { p: /\bbacked\s+by\s+(sequoia|a16z|andreessen|benchmark|accel|greylock|founders fund|khosla|redpoint|nea|lightspeed|insight|general catalyst|thrive|spark|ribbit|iconiq)/i, reason: 'Backed by tier-1' },
  ];

  for (const { p, reason } of bodyFundingPatterns) {
    const match = t.match(p);
    if (match) {
      const idx = match.index;
      const windowStart = Math.max(0, idx - 150);
      const windowEnd = Math.min(t.length, idx + match[0].length + 50);
      const window = t.slice(windowStart, windowEnd);
      // If past-employer signal is within window, this is noise about a previous job
      if (pastEmployerSignal.test(window)) continue;
      // Require explicit present-tense self-reference
      if (presentSelfRef.test(window)) {
        return { disqualified: true, reason };
      }
    }
  }

  // Established-company seniority without departure signal
  const seniorityTitle = /\b(vp|vice president|director|head of|principal|staff|cto|ceo|chief)\s+(of\s+)?(engineering|product|design|data|ml|ai|growth|marketing|sales|technology|executive|operations|technical officer)?\b/i;
  const departureSignal = /\b(ex-|formerly|previously|just left|left\s+\w+\s+(to|for)|departed|exiting|stealth|founder|cofounder|co-founder|building (something|a new)|new venture)\b/i;
  if (seniorityTitle.test(h) && !departureSignal.test(h) && !departureSignal.test(t.slice(0, 600))) {
    // Check if body mentions their current co is mature, with present-tense self-ref nearby
    const matureMatch = t.slice(0, 1500).match(/\b(series [a-z]|\$\d+[mb] raised|\d{3,}\+\s*employees|publicly traded|nasdaq|nyse|post-?ipo)\b/i);
    if (matureMatch) {
      const idx = matureMatch.index;
      const window = t.slice(Math.max(0, idx - 150), idx + matureMatch[0].length + 50);
      if (presentSelfRef.test(window) && !pastEmployerSignal.test(window)) {
        return { disqualified: true, reason: 'Senior title at mature company, no departure signal' };
      }
    }
  }

  return { disqualified: false, reason: null };
}

function extractCompanyInfo(text, headline) {
  const combined = (headline || '') + ' ' + (text || '');

  // Try to extract company name from headline patterns like "Name | Role at Company"
  const patterns = [
    /(?:founder|ceo|cto|co-founder|cofounder)\s+(?:at|of|@)\s+([A-Z][A-Za-z0-9\s&.]+?)(?:\s*[|·—\-]|\s*$)/i,
    /(?:building|launched|started)\s+([A-Z][A-Za-z0-9\s&.]+?)(?:\s*[|·—\-,]|\s*$)/i,
    /\|\s*([A-Z][A-Za-z0-9\s&.]+?)(?:\s*[|·—\-]|\s*$)/,
  ];

  for (const p of patterns) {
    const match = combined.match(p);
    if (match && match[1] && match[1].trim().length > 1 && match[1].trim().length < 50) {
      return match[1].trim();
    }
  }
  return null;
}

// ── Search Queries (ported from Claude Funnel v3, organized by daily theme) ──

// R9: Tighter queries using site: operators, exact-phrase quotes, and negative filters.
// Target LinkedIn profiles directly ("site:linkedin.com/in"), exclude recruiter/hiring noise,
// and rely on structured tokens (quoted phrases) instead of keyword soup.
const NEG = '-"recruiter" -"hiring" -"we are hiring" -"join our team" -"looking for" -"open to work"';

const SEARCH_GROUPS = {
  monday: [
    { name: 'LinkedIn stealth Chicago', query: `site:linkedin.com/in "stealth" ("Chicago" OR "Evanston" OR "Oak Park" OR "Wicker Park") ("founder" OR "co-founder") ${NEG}` },
    { name: 'LinkedIn ex-SF moved Chicago', query: `site:linkedin.com/in ("formerly San Francisco" OR "formerly Bay Area" OR "moved to Chicago") "founder" ${NEG}` },
    { name: 'LinkedIn just left to build Chicago', query: `site:linkedin.com/in ("just left" OR "recently left") ("Chicago" OR "Illinois") "building" ${NEG}` },
    { name: 'LinkedIn YC Chicago founder', query: `site:linkedin.com/in ("Y Combinator" OR "YC W25" OR "YC S25" OR "YC W26") ("Chicago" OR "Evanston") "founder" ${NEG}` },
    { name: 'LinkedIn Techstars Chicago', query: `site:linkedin.com/in "Techstars" ("Chicago" OR "Illinois") "founder" ${NEG}` },
    { name: 'LinkedIn SPC Chicago', query: `site:linkedin.com/in "South Park Commons" ("Chicago" OR "Illinois") ${NEG}` },
    { name: 'LinkedIn On Deck Chicago', query: `site:linkedin.com/in ("On Deck" OR "ODF") ("Chicago" OR "Illinois") "founder" ${NEG}` },
    { name: 'LinkedIn pre-seed Chicago', query: `site:linkedin.com/in "pre-seed" ("Chicago" OR "Evanston") "founder" ${NEG}` },
  ],
  tuesday: [
    { name: 'LinkedIn ex-OpenAI Chicago', query: `site:linkedin.com/in ("ex-OpenAI" OR "formerly OpenAI") ("Chicago" OR "Illinois") ${NEG}` },
    { name: 'LinkedIn ex-Google Chicago', query: `site:linkedin.com/in ("ex-Google" OR "formerly Google" OR "previously Google") ("Chicago" OR "Evanston" OR "Oak Park") "founder" ${NEG}` },
    { name: 'LinkedIn ex-Stripe Chicago', query: `site:linkedin.com/in ("ex-Stripe" OR "formerly Stripe") ("Chicago" OR "Illinois") "founder" ${NEG}` },
    { name: 'LinkedIn ex-Meta Chicago', query: `site:linkedin.com/in ("ex-Meta" OR "formerly Meta" OR "formerly Facebook") ("Chicago" OR "Illinois") ${NEG}` },
    { name: 'LinkedIn ex-Anthropic Chicago', query: `site:linkedin.com/in ("ex-Anthropic" OR "formerly Anthropic") ("Chicago" OR "Illinois") ${NEG}` },
    { name: 'LinkedIn ex-Ramp/Brex Chicago', query: `site:linkedin.com/in ("ex-Ramp" OR "ex-Brex" OR "ex-Plaid") ("Chicago" OR "Illinois") "founder" ${NEG}` },
    { name: 'LinkedIn ex-Anduril Chicago', query: `site:linkedin.com/in ("ex-Anduril" OR "ex-Palantir" OR "ex-SpaceX") ("Chicago" OR "Illinois") ${NEG}` },
    { name: 'LinkedIn eng leader departed Chicago', query: `site:linkedin.com/in ("Head of Engineering" OR "VP Engineering") ("just left" OR "recently departed") ("Chicago" OR "Illinois") ${NEG}` },
  ],
  wednesday: [
    { name: 'LinkedIn AI founder Chicago', query: `site:linkedin.com/in ("AI founder" OR "ML founder") ("Chicago" OR "Illinois") ("stealth" OR "building") ${NEG}` },
    { name: 'LinkedIn LLM agent Chicago', query: `site:linkedin.com/in ("LLM" OR "AI agent") ("founder" OR "co-founder") ("Chicago" OR "Evanston") ${NEG}` },
    { name: 'LinkedIn PhD commercializing Chicago', query: `site:linkedin.com/in "PhD" ("commercializing" OR "spinout") ("Chicago" OR "UIUC" OR "University of Chicago") "founder" ${NEG}` },
    { name: 'LinkedIn Argonne Fermilab spinout', query: `site:linkedin.com/in ("Argonne National Laboratory" OR "Fermilab") ("founder" OR "spinout" OR "CEO") ${NEG}` },
    { name: 'LinkedIn UIUC research spinout', query: `site:linkedin.com/in "University of Illinois" ("PhD" OR "research scientist") "founder" "Chicago" ${NEG}` },
    { name: 'LinkedIn defense founder Chicago', query: `site:linkedin.com/in ("defense tech" OR "dual-use") ("Chicago" OR "Illinois") "founder" ${NEG}` },
    { name: 'LinkedIn climate founder Chicago', query: `site:linkedin.com/in ("climate tech" OR "clean energy") ("Chicago" OR "Illinois") ("founder" OR "stealth") ${NEG}` },
    { name: 'LinkedIn robotics Chicago', query: `site:linkedin.com/in ("robotics" OR "autonomy") ("founder" OR "CEO") ("Chicago" OR "Illinois") ${NEG}` },
  ],
  thursday: [
    { name: 'LinkedIn fintech founder Chicago', query: `site:linkedin.com/in ("fintech" OR "payments" OR "banking") ("Chicago" OR "Illinois") ("founder" OR "stealth") ${NEG}` },
    { name: 'LinkedIn ex-Citadel founder', query: `site:linkedin.com/in ("ex-Citadel" OR "ex-Jump Trading" OR "ex-DRW") ("founder" OR "stealth") ("Chicago" OR "Illinois") ${NEG}` },
    { name: 'LinkedIn healthtech Chicago', query: `site:linkedin.com/in ("healthtech" OR "digital health") ("Chicago" OR "Illinois") ("founder" OR "co-founder") ${NEG}` },
    { name: 'LinkedIn biotech Chicago', query: `site:linkedin.com/in ("biotech" OR "life sciences") ("Chicago" OR "Illinois") ("founder" OR "CEO") ${NEG}` },
    { name: 'LinkedIn vertical SaaS Chicago', query: `site:linkedin.com/in "vertical SaaS" ("Chicago" OR "Illinois") "founder" ${NEG}` },
    { name: 'LinkedIn construction/logistics Chicago', query: `site:linkedin.com/in ("construction tech" OR "logistics tech" OR "supply chain") ("Chicago" OR "Illinois") "founder" ${NEG}` },
    { name: 'LinkedIn cybersec Chicago', query: `site:linkedin.com/in ("cybersecurity" OR "infosec") ("Chicago" OR "Illinois") ("founder" OR "stealth") ${NEG}` },
    { name: 'LinkedIn insurtech Chicago', query: `site:linkedin.com/in "insurtech" ("Chicago" OR "Illinois") "founder" ${NEG}` },
  ],
  friday: [
    { name: 'LinkedIn serial founder Chicago', query: `site:linkedin.com/in ("serial founder" OR "second-time founder" OR "repeat founder") ("Chicago" OR "Illinois") ${NEG}` },
    { name: 'LinkedIn post-exit building Chicago', query: `site:linkedin.com/in ("post-exit" OR "after acquisition" OR "previously exited") ("Chicago" OR "Illinois") "founder" ${NEG}` },
    { name: 'LinkedIn sold company Chicago', query: `site:linkedin.com/in ("sold my company" OR "acquired by") ("Chicago" OR "Illinois") "founder" ${NEG}` },
    { name: 'LinkedIn first engineer solo Chicago', query: `site:linkedin.com/in ("first engineer" OR "founding engineer") ("Chicago" OR "Illinois") ("starting" OR "founder") ${NEG}` },
    { name: 'LinkedIn staff eng exploring Chicago', query: `site:linkedin.com/in ("staff engineer" OR "principal engineer") ("exploring" OR "what's next") ("Chicago" OR "Illinois") ${NEG}` },
    { name: 'LinkedIn Kellogg/Booth founder', query: `site:linkedin.com/in ("Kellogg" OR "Chicago Booth") "founder" ("stealth" OR "building") ${NEG}` },
    { name: 'LinkedIn devtools OSS Chicago', query: `site:linkedin.com/in ("open source maintainer" OR "devtools") ("Chicago" OR "Illinois") "founder" ${NEG}` },
    { name: 'LinkedIn new venture Chicago', query: `site:linkedin.com/in ("new venture" OR "next chapter" OR "building something new") ("Chicago" OR "Illinois") ${NEG}` },
  ],
};

// Evergreen daily — tightest ICP signals, always run
const DAILY_STEALTH_QUERIES = [
  { name: 'LinkedIn stealth Chicago strict', query: `site:linkedin.com/in "stealth mode" ("Chicago" OR "Evanston" OR "Oak Park") "founder" ${NEG}` },
  { name: 'LinkedIn building something new Chicago', query: `site:linkedin.com/in "building something new" ("Chicago" OR "Illinois") ("founder" OR "co-founder") ${NEG}` },
  { name: 'LinkedIn just left Google Chicago', query: `site:linkedin.com/in "just left Google" ("Chicago" OR "Illinois") ${NEG}` },
  { name: 'LinkedIn just left Stripe Chicago', query: `site:linkedin.com/in "just left Stripe" ("Chicago" OR "Illinois") ${NEG}` },
  { name: 'LinkedIn just left OpenAI Chicago', query: `site:linkedin.com/in "just left OpenAI" ("Chicago" OR "Illinois") ${NEG}` },
  { name: 'LinkedIn UChicago founder stealth', query: `site:linkedin.com/in "University of Chicago" ("founder" OR "co-founder") ("stealth" OR "building") ${NEG}` },
  { name: 'LinkedIn Northwestern founder stealth', query: `site:linkedin.com/in "Northwestern" ("founder" OR "co-founder") ("stealth" OR "building") ${NEG}` },
  { name: 'LinkedIn UIUC founder stealth', query: `site:linkedin.com/in "University of Illinois" ("founder" OR "co-founder") ("stealth" OR "building") ${NEG}` },
  { name: 'LinkedIn Kellogg founder', query: `site:linkedin.com/in "Kellogg" ("founder" OR "co-founder") ("stealth" OR "building") ${NEG}` },
  { name: 'LinkedIn Booth founder', query: `site:linkedin.com/in "Chicago Booth" ("founder" OR "co-founder") ("stealth" OR "building") ${NEG}` },
  { name: 'LinkedIn pre-seed Chicago founder', query: `site:linkedin.com/in "pre-seed" ("Chicago" OR "Illinois") "founder" ${NEG}` },
  { name: 'LinkedIn repeat founder Chicago', query: `site:linkedin.com/in ("repeat founder" OR "second-time founder" OR "serial founder") ("Chicago" OR "Illinois") ${NEG}` },
];

function getTodaySearchGroup() {
  const days = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'];
  const dayName = days[new Date().getDay()];
  // Weekend defaults to monday
  if (dayName === 'saturday' || dayName === 'sunday') return SEARCH_GROUPS.monday;
  return SEARCH_GROUPS[dayName] || SEARCH_GROUPS.monday;
}

// ── Exa AI Search ──

async function searchExa(query, numResults = 25, exaApiKey = null) {
  const apiKey = exaApiKey || process.env.EXA_API_KEY;
  if (!apiKey) return { results: [], error: 'No EXA_API_KEY configured' };

  try {
    const resp = await httpPost('https://api.exa.ai/search', {
      'x-api-key': apiKey,
    }, {
      query,
      type: 'auto',
      num_results: numResults,
      category: 'people',
      contents: { text: { max_characters: 8000 } },
    });

    if (resp.status !== 200) {
      return { results: [], error: `Exa HTTP ${resp.status}: ${JSON.stringify(resp.data).slice(0, 200)}` };
    }

    return { results: resp.data.results || [] };
  } catch (err) {
    return { results: [], error: err.message };
  }
}

// ── GitHub Search ──

async function searchGitHub(criteria, githubToken) {
  try {
    const token = githubToken || process.env.GITHUB_TOKEN;
    const headers = { 'Accept': 'application/vnd.github.v3+json', 'User-Agent': 'Stu-Sourcing' };
    if (token) headers['Authorization'] = `token ${token}`;

    // Build queries dynamically from user's target locations
    const locations = (criteria.locations || []).length > 0 ? criteria.locations : ['Chicago'];
    const queries = [];
    for (const loc of locations.slice(0, 5)) {
      const encodedLoc = loc.includes(' ') ? `"${loc}"` : loc;
      queries.push(`location:${encodedLoc}+type:user+repos:>5+followers:>20`);
      queries.push(`location:${encodedLoc}+type:user+repos:>10+followers:>50`);
    }
    // Add language-specific queries for top 2 locations
    const topLocs = locations.slice(0, 2);
    for (const loc of topLocs) {
      const encodedLoc = loc.includes(' ') ? `"${loc}"` : loc;
      for (const lang of ['python', 'typescript', 'rust', 'go']) {
        queries.push(`location:${encodedLoc}+type:user+language:${lang}+followers:>15`);
      }
    }

    const allUsers = [];
    for (const q of queries.slice(0, 15)) {
      const resp = await httpGet(`https://api.github.com/search/users?q=${q}&sort=joined&order=desc&per_page=10`, headers);
      if (resp.status === 200 && resp.data.items) {
        allUsers.push(...resp.data.items);
      }
    }

    return allUsers.map(u => ({
      name: u.login,
      headline: `GitHub: ${u.login}${u.bio ? ' — ' + u.bio : ''}`,
      text: `GitHub user ${u.login}. ${u.bio || ''} Location: ${u.location || 'Unknown'}. Repos: ${u.public_repos || 0}. Followers: ${u.followers || 0}.`,
      url: u.html_url,
      linkedin_url: null,
      github_url: u.html_url,
      email: u.email || null,
      source: 'github',
    }));
  } catch (err) {
    console.error('[Sourcing][GitHub] Error:', err.message);
    return [];
  }
}

// ── EnrichLayer (LinkedIn enrichment for top scorers) ──

async function enrichWithLinkedIn(linkedinUrl, enrichlayerApiKey) {
  const apiKey = enrichlayerApiKey || process.env.ENRICHLAYER_API_KEY;
  if (!apiKey || !linkedinUrl) return null;

  try {
    const resp = await httpGet(
      `https://api.enrichlayer.com/v1/linkedin/profile?url=${encodeURIComponent(linkedinUrl)}`,
      { 'x-api-key': apiKey }
    );

    if (resp.status === 200 && resp.data) {
      return resp.data;
    }
    return null;
  } catch {
    return null;
  }
}

// ── Claude Scoring ──

// R4: Extract-then-score prompt. Forces verbatim quotes as evidence, defaults to 5 when
// evidence is missing, surfaces red flags, and treats elite national schools as pedigree
// only (never as a standalone Chicago tie — R10).
const SCORING_PROMPT = `You are the deal sourcing analyst for Superior Studios, a Chicago-based PRE-SEED venture fund (~$10M Fund I). Every candidate shown to Danny must be a top-decile fit. False positives are more expensive than false negatives — err on the side of "pass" when evidence is thin.

Your job has two stages:
STAGE 1 — EXTRACT. For each scoring dimension, pull the *verbatim* quote from the profile text that justifies a claim. If no quote exists for a dimension, the evidence for that dimension is empty.
STAGE 2 — SCORE. Only score a dimension above 5 when you have a verbatim quote supporting it. If evidence is empty or ambiguous, default to 5. Do not extrapolate.

Who we want (the ICP):
- Stealth founders who just left a senior role and haven't gone public
- Recently-departed senior ops/eng from category-defining companies (FAANG, Stripe, OpenAI, Anthropic, Ramp, Anduril, Scale, Databricks)
- Repeat founders in transition (post-exit, post-acquisition, post-shutdown, now building again)
- High-pedigree operators with Chicago/IL ties poised to start something

Hard disqualifiers (auto-score 1-3, regardless of other signals):
- Company has RAISED Series A or later
- Company has raised a large seed ($5M+)
- Candidate is a senior exec at an established co with NO departure signal
- Candidate is clearly a job-seeker or recruiter, not a builder
- Candidate is a student with a portfolio project and no commercial evidence
- Candidate is a service provider (consultant, agency, recruiter) not a founder

Location rules — CRITICAL:
- Tie categories in priority order: current Chicago/IL residence > Chicago-based work > Illinois school alumni (Northwestern/UChicago/UIUC/IIT/Kellogg/Booth/Loyola/DePaul) > hometown/raised in IL > worked at Chicago-HQ company (Grubhub/Groupon/Avant/Braintree/Tempus/Sprout/Cameo).
- National elite schools (Stanford, Harvard, MIT, Berkeley, CMU, Princeton, Yale, Columbia, Penn/Wharton, Cornell) are PEDIGREE MULTIPLIERS, not ties. Attending an elite national school without one of the above tie types = geography score 3-4, not 7+.
- The strongest combination is: elite national school + verified Chicago/IL tie + one of the four archetype signals. Flag it explicitly in rationale when you see it.

Recency rules — CRITICAL:
- "Just left" / "recently departed" is only a 9-10 stage signal if the departure was WITHIN 6 MONTHS. Estimate months-since-departure from the text.
- If the profile says "just left" but with no date, and no other freshness signals, assume 6+ months and score stage 5-6, not 9-10.
- Explicitly named recent dates (2025, 2026) count as fresh if within the last 6 months.

Stage & timing rubric (25% weight):
- 9-10: Stealth, departed top company <=3 months ago, no funding
- 7-8: Early (prototype/MVP), founded <12mo, pre-seed or small angel
- 5-6: Exploring, still employed, side-building
- 3-4: Has raised seed $2-4M
- 1-2: Series A+ or established

Founder caliber (35% weight):
- 9-10: Previously exited. Serial founder. Staff+/VP/Director at target companies (Google/Meta/Stripe/OpenAI/Anthropic/Ramp/Anduril/Scale/Databricks). YC/TechStars/SPC alum. PhD from elite school commercializing.
- 7-8: Staff+ at notable co. Elite institution grad. Exceptional domain depth.
- 5-6: Solid pro background. Good institution.
- 3-4: Junior or unclear.
- 1-2: No relevant experience.

Geography (25% weight): per tie-category priority above.

Sector fit (15% weight):
- Ideal: B2B SaaS, AI/ML, devtools, fintech, healthtech, defense/govtech, vertical software
- Good if exceptional: deep tech, climate, biotech
- Lower: consumer, social, crypto

Return ONLY valid JSON in this exact shape:
{
  "evidence_map": {
    "tie_evidence": "<verbatim quote or empty string>",
    "tie_type": "<one of: current|working|school_alumni|hometown|chicago_company|none>",
    "caliber_evidence": "<verbatim quote or empty string>",
    "stage_evidence": "<verbatim quote or empty string>",
    "sector_evidence": "<verbatim quote or empty string>"
  },
  "departure_recency_months": <integer months since last role change, or null if unknown>,
  "anchor_schools_il": ["<IL schools attended, verbatim>"],
  "elite_schools_national": ["<national elite schools attended, verbatim>"],
  "red_flags": ["<concrete red flags: 'student, no commercial evidence', 'Series B company', 'recruiter, not builder', etc.>"],
  "confidence_score": <1-10 integer; default 5 if evidence is thin>,
  "confidence_rationale": "<2-3 sentences. Cite the verbatim evidence. If score is low, say WHY specifically. If score is high, explain which archetype + tie they match.>",
  "tags": ["<domain>", "<stage>", "<geography>", "<signal>"],
  "chicago_connection": "<one sentence; if no tie, write 'No verified tie'>",
  "pedigree_signals": ["<'Ex-Google Staff Eng', 'Northwestern Kellogg MBA', etc.>"],
  "builder_signals": ["<'Previous exit (acquired by X)', 'YC W24', etc.>"],
  "company_one_liner": "<what they're building, or 'Stealth' or 'Exploring' if unclear>"
}`;

function emptyScore(rationale) {
  return {
    confidence_score: 5,
    confidence_rationale: rationale,
    tags: [],
    chicago_connection: '',
    pedigree_signals: [],
    builder_signals: [],
    company_one_liner: '',
    evidence_map: {},
    departure_recency_months: null,
    anchor_schools_il: [],
    elite_schools_national: [],
    red_flags: [],
  };
}

async function scoreFounder(client, founder, scoringPrompt) {
  try {
    const response = await client.messages.create({
      model: 'claude-sonnet-4-20250514',
      max_tokens: 1536,
      system: scoringPrompt || SCORING_PROMPT,
      messages: [{
        role: 'user',
        content: `Score this founder candidate:\n\nName: ${founder.name}\nHeadline: ${founder.headline || 'N/A'}\nCompany: ${founder.company || 'Unknown'}\nLinkedIn: ${founder.linkedin_url || 'N/A'}\nGitHub: ${founder.github_url || 'N/A'}\nSource: ${founder.source}\nPre-extracted anchor IL schools: ${JSON.stringify(founder.anchor_schools_il || [])}\nPre-extracted elite national schools: ${JSON.stringify(founder.elite_schools_national || [])}\n\nProfile text:\n${(founder.text || '').slice(0, 4000)}`
      }]
    });

    const text = response.content[0].text.trim();
    const jsonMatch = text.match(/\{[\s\S]*\}/);
    if (!jsonMatch) return emptyScore('Could not parse scoring response');
    const parsed = JSON.parse(jsonMatch[0]);

    // R3: normalize recency — clamp to valid range
    let recency = parsed.departure_recency_months;
    if (recency !== null && recency !== undefined) {
      recency = parseInt(recency);
      if (isNaN(recency) || recency < 0 || recency > 240) recency = null;
    } else {
      recency = null;
    }

    // R3: decay the score if "just left" claim is stale (>6 months without freshness)
    let score = parsed.confidence_score || 5;
    const rawScore = score;
    if (recency !== null && recency > 6 && score >= 8) {
      score = Math.max(5, score - 2);
    }

    return {
      confidence_score: score,
      raw_confidence_score: rawScore,
      confidence_rationale: parsed.confidence_rationale || '',
      tags: parsed.tags || [],
      chicago_connection: parsed.chicago_connection || '',
      pedigree_signals: parsed.pedigree_signals || [],
      builder_signals: parsed.builder_signals || [],
      company_one_liner: parsed.company_one_liner || '',
      evidence_map: parsed.evidence_map || {},
      departure_recency_months: recency,
      anchor_schools_il: parsed.anchor_schools_il || [],
      elite_schools_national: parsed.elite_schools_national || [],
      red_flags: parsed.red_flags || [],
    };
  } catch (err) {
    return emptyScore('Scoring failed: ' + err.message);
  }
}

// ── Deduplication ──

// R7: Dedup rules
//   - Match ANY sourced_founders row (including dismissed) that has do_not_resurface=1
//     → block forever. User explicitly said "never show again."
//   - Match any non-dismissed sourced_founders row → block (already in queue).
//   - Dismissed rows with do_not_resurface=0 → allow re-surface (intentional: user
//     may want second look later when circumstances change).
function isDuplicate(founder, userId) {
  if (founder.linkedin_url) {
    const normalizedUrl = founder.linkedin_url.replace(/\/$/, '').toLowerCase();
    const slug = normalizedUrl.split('/in/')[1] || normalizedUrl;
    const existing = db.prepare('SELECT id FROM founders WHERE LOWER(linkedin_url) LIKE ? AND created_by = ? AND is_deleted = 0').get(`%${slug}%`, userId);
    if (existing) return true;
    const sourced = db.prepare("SELECT id FROM sourced_founders WHERE LOWER(linkedin_url) LIKE ? AND user_id = ? AND (status != 'dismissed' OR do_not_resurface = 1)").get(`%${slug}%`, userId);
    if (sourced) return true;
  }
  if (founder.email) {
    const existing = db.prepare('SELECT id FROM founders WHERE email = ? AND created_by = ? AND is_deleted = 0').get(founder.email, userId);
    if (existing) return true;
    const sourced = db.prepare("SELECT id FROM sourced_founders WHERE email = ? AND user_id = ? AND (status != 'dismissed' OR do_not_resurface = 1)").get(founder.email, userId);
    if (sourced) return true;
  }
  if (founder.name && founder.company) {
    const existing = db.prepare('SELECT id FROM founders WHERE LOWER(name) = LOWER(?) AND LOWER(company) = LOWER(?) AND created_by = ? AND is_deleted = 0').get(founder.name, founder.company, userId);
    if (existing) return true;
    const sourced = db.prepare("SELECT id FROM sourced_founders WHERE LOWER(name) = LOWER(?) AND LOWER(company) = LOWER(?) AND user_id = ? AND (status != 'dismissed' OR do_not_resurface = 1)").get(founder.name, founder.company, userId);
    if (sourced) return true;
  }
  return false;
}

// ── Slack Notification ──

async function notifySlack(message) {
  const webhookUrl = process.env.SLACK_WEBHOOK_URL;
  if (!webhookUrl) return;
  try {
    await httpPost(webhookUrl, {}, { text: message });
  } catch (err) {
    console.error('[Sourcing][Slack] Failed:', err.message);
  }
}

// ── Main Engine ──

// Extra broad queries for full sweeps — potential founders, recent job changes, talent pool
const BROAD_TALENT_QUERIES = [
  { name: 'Staff eng Chicago leaving', query: 'staff engineer principal engineer Chicago Illinois leaving exploring founding starting 2025' },
  { name: 'VP product Chicago starting', query: 'VP product director product Chicago Illinois starting founding new company 2025 stealth' },
  { name: 'CTO Chicago new company', query: 'CTO chief technology officer Chicago Illinois starting new company stealth pre-seed' },
  { name: 'Technical founder Chicago pre-seed', query: 'technical founder Chicago Illinois pre-seed building new product MVP prototype 2025' },
  { name: 'Solo founder Chicago building', query: 'solo founder Chicago Illinois building new app product stealth bootstrapping pre-seed' },
  { name: 'First-time founder Chicago', query: 'first time founder Chicago Illinois building new startup 2024 2025 pre-seed stealth' },
  { name: 'PhD commercializing Chicago', query: 'PhD researcher commercializing starting company Chicago Illinois new startup deep tech' },
  { name: 'Ex-unicorn Chicago founder', query: 'left unicorn startup Chicago Illinois starting new company founder stealth pre-seed 2025' },
  { name: 'Acquired founder new co Chicago', query: 'acquired exited sold previous startup founder new company Chicago Illinois stealth 2025' },
  { name: 'Builder Chicago pre-launch', query: 'builder maker hacker Chicago Illinois pre-launch new product startup 2025 founder' },
  { name: 'Midwest stealth founder', query: 'stealth mode founder Midwest Illinois Indiana Wisconsin Iowa building new startup pre-seed' },
  { name: 'Chicago tech scene founder', query: 'Chicago tech startup scene founder building new company 2025 early stage pre-seed stealth' },
  { name: 'IL school alumni founding', query: 'Northwestern UChicago UIUC Illinois alumni founding starting new company stealth pre-seed 2025' },
  { name: 'Michigan alum Chicago founder', query: 'University of Michigan alumni Chicago Illinois founding starting stealth new company pre-seed' },
  { name: 'Stanford Harvard alum Chicago', query: 'Stanford Harvard MIT alumni Chicago Illinois starting founding stealth new company pre-seed' },
  { name: 'Immigrant founder Chicago', query: 'immigrant founder building Chicago Illinois new startup pre-seed stealth technical 2025' },
];

function getAllSearchQueries() {
  const all = [];
  for (const day of Object.values(SEARCH_GROUPS)) {
    all.push(...day);
  }
  all.push(...DAILY_STEALTH_QUERIES);
  all.push(...BROAD_TALENT_QUERIES);
  return all;
}

// ── Per-user criteria loader ──

function loadUserCriteria(userId) {
  const keys = [
    'sourcing_locations', 'sourcing_schools', 'sourcing_companies',
    'sourcing_builder_signals', 'sourcing_domains', 'sourcing_stage_filter',
    'sourcing_custom_queries',
  ];
  const rows = db.prepare(
    `SELECT setting_key, setting_value FROM user_settings WHERE user_id = ? AND setting_key IN (${keys.map(() => '?').join(',')})`
  ).all(userId, ...keys);

  const userMap = {};
  for (const row of rows) userMap[row.setting_key] = row.setting_value;

  function parse(val, fallback) {
    if (val === undefined || val === null) return fallback;
    try { return JSON.parse(val); } catch { return val; }
  }

  // Respect user selections — empty arrays mean "no preference", not "use defaults"
  return {
    locations: parse(userMap.sourcing_locations, []),
    schools: parse(userMap.sourcing_schools, []),
    companies: parse(userMap.sourcing_companies, []),
    builderSignals: parse(userMap.sourcing_builder_signals, []),
    domains: parse(userMap.sourcing_domains, []),
    stageFilter: parse(userMap.sourcing_stage_filter, 'Any'),
    customQueries: parse(userMap.sourcing_custom_queries, []),
  };
}

function buildUserSearchQueries(criteria, fullSweep) {
  const locs = criteria.locations.slice(0, 5);
  const companies = criteria.companies.slice(0, 8);
  const schools = criteria.schools.slice(0, 5);
  const domains = criteria.domains.slice(0, 6);
  const stage = criteria.stageFilter || 'Any';
  const hasLocs = locs.length > 0;
  const stageStr = stage === 'Any' ? '' : stage;

  const queries = [];

  if (hasLocs) {
    // Location-specific stealth founder queries
    for (const loc of locs.slice(0, 3)) {
      queries.push({ name: `Stealth founder ${loc}`, query: `stealth mode founder ${loc} building something new just left 2025 2026` });
      queries.push({ name: `LinkedIn stealth ${loc}`, query: `site:linkedin.com/in "stealth" "${loc}" founder building` });
      queries.push({ name: `Building new ${loc}`, query: `site:linkedin.com/in "building something new" ${loc} founder engineer` });
    }
  } else {
    // Broad stealth founder queries (no location filter)
    queries.push({ name: 'Stealth founder broad', query: `stealth mode founder building something new just left 2025 2026 startup` });
    queries.push({ name: 'LinkedIn stealth broad', query: `site:linkedin.com/in "stealth" founder building startup 2025` });
    queries.push({ name: 'Building new broad', query: `site:linkedin.com/in "building something new" founder engineer startup` });
  }

  // Ex-company queries
  const locSuffix = hasLocs ? ` ${locs[0]}` : '';
  for (const co of companies.slice(0, 5)) {
    queries.push({ name: `Ex-${co} stealth`, query: `left ${co} stealth new startup${locSuffix} founder ${stageStr} 2025`.trim() });
  }

  // School alumni queries
  for (const school of schools.slice(0, 3)) {
    queries.push({ name: `${school} founder stealth`, query: `site:linkedin.com/in "${school}" founder stealth building startup${locSuffix}`.trim() });
  }

  // Domain queries
  for (const domain of domains.slice(0, 4)) {
    queries.push({ name: `${domain} stealth`, query: `${domain} stealth founder${locSuffix} new startup ${stageStr} 2025`.trim() });
  }

  // Generic high-signal queries
  queries.push({ name: 'Serial founder stealth', query: `serial founder exited previous company building new startup${locSuffix} stealth ${stageStr} 2025`.trim() });
  if (stageStr) {
    queries.push({ name: `${stageStr} founders`, query: `site:linkedin.com/in "${stageStr}" founder building startup${locSuffix}`.trim() });
  }
  queries.push({ name: 'YC alum new', query: `Y Combinator YC alumni starting new company${locSuffix} stealth exploring`.trim() });
  queries.push({ name: 'Just quit to build', query: `just quit left job to start build company${locSuffix} founder stealth 2025 2026`.trim() });

  // Custom queries from user
  for (const cq of (criteria.customQueries || [])) {
    if (cq.query) queries.push({ name: cq.name || 'Custom query', query: cq.query });
  }

  if (!fullSweep) return queries.slice(0, 20);
  return queries;
}

// R4: User-customized prompt reuses the base SCORING_PROMPT's extract-then-score
// structure and output schema. Only the criteria preface differs.
function buildUserScoringPrompt(criteria) {
  const locations = (criteria.locations || []).join(', ') || 'Chicago, Illinois';
  const schools = (criteria.schools || []).join(', ') || 'Northwestern, UChicago, UIUC, IIT, Kellogg, Booth, Loyola, DePaul';
  const companies = (criteria.companies || []).join(', ') || 'Google, Meta, Stripe, OpenAI, Anthropic, Ramp, Anduril, Scale, Databricks';
  const domains = (criteria.domains || []).join(', ') || 'B2B SaaS, AI/ML, devtools, fintech, healthtech, defense, vertical software';
  const stage = criteria.stageFilter || 'Pre-seed';

  const preface = `Criteria for this run:
- Target stage: ${stage}
- Target locations (tie-qualifying): ${locations}
- Target local-anchor schools (tie + pedigree): ${schools}
- Target pedigree-qualifying companies: ${companies}
- Target sectors: ${domains}

`;
  return preface + SCORING_PROMPT;
}

// ── User API Key Loader ──

function loadUserApiKeys(userId) {
  const rows = db.prepare(
    "SELECT setting_key, setting_value FROM user_settings WHERE user_id = ? AND setting_key IN ('api_key_exa', 'api_key_anthropic', 'api_key_enrichlayer', 'api_key_github')"
  ).all(userId);

  const keys = {};
  for (const row of rows) keys[row.setting_key] = row.setting_value;

  // User_id 1 (original admin) falls back to env vars for backward compat
  return {
    exa: keys.api_key_exa || (userId === 1 ? process.env.EXA_API_KEY : null),
    anthropic: keys.api_key_anthropic || (userId === 1 ? process.env.ANTHROPIC_API_KEY : null),
    enrichlayer: keys.api_key_enrichlayer || (userId === 1 ? process.env.ENRICHLAYER_API_KEY : null),
    github: keys.api_key_github || (userId === 1 ? process.env.GITHUB_TOKEN : null),
  };
}

async function runSourcingEngine({ fullSweep = false, userId = 1 } = {}) {
  console.log(`[Sourcing] Starting sourcing run for user ${userId}... (mode: ${fullSweep ? 'FULL SWEEP' : 'daily rotation'})`);

  // Load user-specific criteria and API keys
  const criteria = loadUserCriteria(userId);
  const apiKeys = loadUserApiKeys(userId);

  // Require at minimum an Exa key to run sourcing
  if (!apiKeys.exa) {
    console.log(`[Sourcing] User ${userId} has no Exa API key configured — skipping sourcing run`);
    return { totalFound: 0, totalAdded: 0, totalDeduped: 0, totalFiltered: 0, errors: [{ source: 'config', error: 'No Exa API key configured. Add your API key in Settings.' }] };
  }

  console.log(`[Sourcing] User ${userId} criteria: ${criteria.locations.length} locations, ${criteria.schools.length} schools, ${criteria.companies.length} companies, ${criteria.domains.length} domains`);
  console.log(`[Sourcing] User ${userId} API keys: Exa=${apiKeys.exa ? 'yes' : 'no'}, Anthropic=${apiKeys.anthropic ? 'yes' : 'no'}, Enrich=${apiKeys.enrichlayer ? 'yes' : 'no'}, GitHub=${apiKeys.github ? 'yes' : 'no'}`);

  const run = db.prepare('INSERT INTO sourcing_runs (sources_hit, user_id) VALUES (?, ?)').run(JSON.stringify([]), userId);
  const runId = run.lastInsertRowid;

  const sourcesHit = [];
  const errors = [];
  let totalFound = 0;
  let totalAdded = 0;
  let totalDeduped = 0;
  let totalFiltered = 0;

  // ── Phase 1: Exa AI searches ──
  // Build search queries from user criteria
  const searchGroup = buildUserSearchQueries(criteria, fullSweep);
  const dayName = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'][new Date().getDay()];
  console.log(`[Sourcing] Today is ${dayName} — running ${searchGroup.length} Exa queries for user ${userId}${fullSweep ? ' (FULL SWEEP)' : ' (daily)'}`);

  const exaCandidates = [];

  const resultsPerQuery = fullSweep ? 50 : 25;

  for (const search of searchGroup) {
    console.log(`[Sourcing][Exa] ${search.name}...`);
    const { results, error } = await searchExa(search.query, resultsPerQuery, apiKeys.exa);

    if (error) {
      console.error(`[Sourcing][Exa] ${search.name} error: ${error}`);
      errors.push({ source: 'exa', query: search.name, error });
      continue;
    }

    sourcesHit.push(`exa:${search.name}`);
    let verified = 0;

    for (const result of results) {
      const headline = result.title || '';
      const text = result.text || '';
      const url = result.url || '';

      // Only interested in LinkedIn profiles or personal pages
      const isLinkedIn = url.includes('linkedin.com/in/');

      // Verify location connection using user's target locations
      const il = verifyLocation(text, headline, criteria);
      if (!il.verified) {
        totalFiltered++;
        continue;
      }

      verified++;

      // Extract name from headline (before | or — or -)
      let name = headline.split(/[|·—\-]/)[0].trim();
      if (name.length > 60) name = name.slice(0, 60);
      if (!name || name.length < 2) continue;

      const company = extractCompanyInfo(text, headline);
      const signals = extractSignals(text, headline);

      exaCandidates.push({
        name,
        company,
        headline: headline.slice(0, 500),
        text: text.slice(0, 8000),
        linkedin_url: isLinkedIn ? url : null,
        email: null,
        github_url: null,
        source: 'exa',
        search_query: search.name,
        location_city: il.location,
        location_type: il.type,
        pedigree_signals: signals.pedigree,
        builder_signals: signals.builder,
        anchor_schools_il: signals.anchor_schools_il || [],
        elite_schools_national: signals.elite_schools_national || [],
      });
    }

    console.log(`[Sourcing][Exa] ${search.name}: ${results.length} results → ${verified} location-verified`);
    totalFound += results.length;
  }

  // ── Phase 2: GitHub search ──
  console.log('[Sourcing][GitHub] Searching...');
  const githubResults = await searchGitHub(criteria, apiKeys.github);
  console.log(`[Sourcing][GitHub] Found ${githubResults.length} users`);
  sourcesHit.push('github');
  totalFound += githubResults.length;

  // Process GitHub results through IL verification
  for (const gh of githubResults) {
    const il = verifyLocation(gh.text, gh.headline, criteria);
    if (il.verified) {
      exaCandidates.push({
        ...gh,
        location_city: il.location,
        location_type: il.type,
        pedigree_signals: [],
        builder_signals: ['Active GitHub'],
        search_query: 'github',
      });
    }
  }

  // ── Phase 3: Dedup across all candidates ──
  console.log(`[Sourcing] Deduplicating ${exaCandidates.length} IL-verified candidates...`);

  // Dedup within this batch first (by LinkedIn URL)
  const seen = new Set();
  const uniqueCandidates = [];
  for (const c of exaCandidates) {
    const key = c.linkedin_url
      ? c.linkedin_url.replace(/\/$/, '').toLowerCase()
      : `${c.name}::${c.company || ''}`.toLowerCase();
    if (seen.has(key)) {
      totalDeduped++;
      continue;
    }
    seen.add(key);

    if (isDuplicate(c, userId)) {
      totalDeduped++;
      continue;
    }
    uniqueCandidates.push(c);
  }

  console.log(`[Sourcing] ${uniqueCandidates.length} unique, new candidates to score`);

  // ── Phase 4: Claude scoring ──
  const anthropic = apiKeys.anthropic ? (() => {
    try { const Anthropic = require('@anthropic-ai/sdk'); return new Anthropic({ apiKey: apiKeys.anthropic }); } catch { return null; }
  })() : getAnthropicClient();
  const userScoringPrompt = buildUserScoringPrompt(criteria);
  const insertStmt = db.prepare(`
    INSERT INTO sourced_founders (
      name, company, role, linkedin_url, email, source,
      confidence_score, confidence_rationale, raw_data,
      headline, location_city, location_type, chicago_connection,
      tags, search_query, company_one_liner,
      pedigree_signals, builder_signals, github_url, website_url,
      user_id,
      departure_recency_months, signal_captured_at,
      anchor_schools_il, elite_schools_national,
      evidence_map, red_flags
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP, ?, ?, ?, ?)
  `);

  for (const candidate of uniqueCandidates) {
    // Pre-filter: skip founders who are obviously too far along (saves Claude API calls)
    const stageCheck = isTooFarAlong(candidate.text, candidate.headline);
    if (stageCheck.disqualified) {
      console.log(`[Sourcing] ⏭️ ${candidate.name} — skipped: ${stageCheck.reason}`);
      totalFiltered++;
      continue;
    }

    let score = {
      confidence_score: 5,
      confidence_rationale: 'AI scoring unavailable',
      tags: [],
      chicago_connection: candidate.location_city || '',
      pedigree_signals: candidate.pedigree_signals || [],
      builder_signals: candidate.builder_signals || [],
      company_one_liner: '',
    };

    if (anthropic) {
      score = await scoreFounder(anthropic, candidate, userScoringPrompt);
    }

    // Merge extracted signals with AI signals
    const allPedigree = [...new Set([...(candidate.pedigree_signals || []), ...(score.pedigree_signals || [])])];
    const allBuilder = [...new Set([...(candidate.builder_signals || []), ...(score.builder_signals || [])])];

    // Merge pre-extracted schools with AI-extracted schools (R10)
    const allAnchorIl = [...new Set([...(candidate.anchor_schools_il || []), ...(score.anchor_schools_il || [])])];
    const allEliteNational = [...new Set([...(candidate.elite_schools_national || []), ...(score.elite_schools_national || [])])];

    try {
      insertStmt.run(
        candidate.name,
        candidate.company || score.company_one_liner?.split(' ')[0] || null,
        'Founder',
        candidate.linkedin_url || null,
        candidate.email || null,
        candidate.source,
        score.confidence_score,
        score.confidence_rationale,
        JSON.stringify({ headline: candidate.headline, text: (candidate.text || '').slice(0, 2000) }),
        candidate.headline || null,
        candidate.location_city || null,
        candidate.location_type || null,
        score.chicago_connection || candidate.location_city || null,
        JSON.stringify(score.tags || []),
        candidate.search_query || null,
        score.company_one_liner || null,
        JSON.stringify(allPedigree),
        JSON.stringify(allBuilder),
        candidate.github_url || null,
        null,
        userId,
        score.departure_recency_months,
        JSON.stringify(allAnchorIl),
        JSON.stringify(allEliteNational),
        JSON.stringify(score.evidence_map || {}),
        JSON.stringify(score.red_flags || [])
      );
      totalAdded++;

      const scoreEmoji = score.confidence_score >= 8 ? '🔥' : score.confidence_score >= 6 ? '✅' : '📝';
      console.log(`[Sourcing] ${scoreEmoji} ${candidate.name} (${candidate.company || 'stealth'}) → ${score.confidence_score}/10 [${candidate.location_type}:${candidate.location_city}]`);
    } catch (err) {
      console.error(`[Sourcing] Insert error for ${candidate.name}: ${err.message}`);
      errors.push({ source: candidate.source, name: candidate.name, error: err.message });
    }
  }

  // ── Phase 5: EnrichLayer for top scorers ──
  if (apiKeys.enrichlayer) {
    const topScorers = db.prepare(
      "SELECT id, linkedin_url FROM sourced_founders WHERE status = 'pending' AND user_id = ? AND confidence_score >= 8 AND linkedin_url IS NOT NULL AND enriched_data IS NULL ORDER BY confidence_score DESC LIMIT 5"
    ).all(userId);

    if (topScorers.length > 0) {
      console.log(`[Sourcing][Enrich] Enriching ${topScorers.length} top scorers...`);
      for (const s of topScorers) {
        const data = await enrichWithLinkedIn(s.linkedin_url, apiKeys.enrichlayer);
        if (data) {
          db.prepare('UPDATE sourced_founders SET enriched_data = ? WHERE id = ? AND user_id = ?').run(JSON.stringify(data), s.id, userId);
          console.log(`[Sourcing][Enrich] Enriched ${s.linkedin_url}`);
        }
        // Rate limit: 800ms between requests
        await new Promise(r => setTimeout(r, 800));
      }
    }
  }

  // ── Phase 5.5: Co-founder pair detection (R5) ──
  try {
    const { detectPairs } = require('./pair-detector');
    const pairStats = detectPairs({ userId, windowDays: 90 });
    if (pairStats.pairsFound > 0) {
      console.log(`[Sourcing][Pairs] ${pairStats.pairsFound} pair(s), ${pairStats.rowsBumped} row(s) bumped`);
      sourcesHit.push(`pairs:${pairStats.pairsFound}`);
    }
  } catch (err) {
    console.error('[Sourcing][Pairs] Error:', err.message);
    errors.push({ source: 'pair-detector', error: err.message });
  }

  // ── Phase 5.6: GitHub activity depth (R8) for top scorers ──
  try {
    const { scoreGithubActivity } = require('./github-activity');
    await scoreGithubActivity({ userId, githubToken: apiKeys.github, limit: 10 });
  } catch (err) {
    console.error('[Sourcing][GH-Activity] Error:', err.message);
    errors.push({ source: 'github-activity', error: err.message });
  }

  // ── Phase 6: Update run log ──
  db.prepare('UPDATE sourcing_runs SET sources_hit = ?, founders_found = ?, founders_added = ?, founders_deduplicated = ?, errors = ? WHERE id = ?').run(
    JSON.stringify(sourcesHit), totalFound, totalAdded, totalDeduped, JSON.stringify(errors), runId
  );

  // ── Phase 7: Slack notification ──
  const topPick = db.prepare("SELECT name, company, confidence_score, chicago_connection FROM sourced_founders WHERE status = 'pending' AND user_id = ? ORDER BY confidence_score DESC, created_at DESC LIMIT 1").get(userId);
  const pendingCount = db.prepare("SELECT COUNT(*) as c FROM sourced_founders WHERE status = 'pending' AND user_id = ?").get(userId).c;

  const slackMsg = `*Stu Sourcing Run Complete* (${dayName})\n` +
    `${totalAdded} new founders added · ${totalDeduped} duplicates filtered · ${totalFiltered} location-filtered\n` +
    `${pendingCount} total pending review\n` +
    (topPick ? `Top pick: *${topPick.name}*${topPick.company ? ` (${topPick.company})` : ''} — Score: ${topPick.confidence_score}/10${topPick.chicago_connection ? ` · ${topPick.chicago_connection}` : ''}` : 'No new founders found');

  await notifySlack(slackMsg);

  console.log(`[Sourcing] ✅ Complete: ${totalFound} found → ${totalAdded} added, ${totalDeduped} deduped, ${totalFiltered} filtered, ${errors.length} errors`);
  return { totalFound, totalAdded, totalDeduped, totalFiltered, errors };
}

module.exports = { runSourcingEngine, enrichWithLinkedIn };
