/**
 * Superior Studios — Talent Sourcing Engine
 * ==========================================
 * Finds exceptional technical talent for portfolio-company hiring.
 *
 * DIFFERENT from sourcing-engine.js (which finds founders):
 *  - Targets IC/engineer/operator talent, not founders
 *  - Scores on: build caliber, leap readiness, domain fit, geography
 *  - Three bands: A (founding eng / cofounder), B (first-5 hire), C (domain expert)
 *  - Pulls from Exa + GitHub; hits LinkedIn "exploring" + "stealth-adjacent" signals
 *
 * Uses the same Exa / Anthropic / GitHub clients from the founder engine.
 */

const db = require('../db');
const https = require('https');

// ── HTTP helpers ──
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
      res.on('data', c => result += c);
      res.on('end', () => { try { resolve({ status: res.statusCode, data: JSON.parse(result) }); } catch { resolve({ status: res.statusCode, data: result }); } });
    });
    req.on('error', reject);
    req.write(data);
    req.end();
  });
}
function httpGet(url, headers) {
  return new Promise((resolve, reject) => {
    const parsed = new URL(url);
    const req = https.get({ hostname: parsed.hostname, path: parsed.pathname + parsed.search, headers }, (res) => {
      let result = '';
      res.on('data', c => result += c);
      res.on('end', () => { try { resolve({ status: res.statusCode, data: JSON.parse(result) }); } catch { resolve({ status: res.statusCode, data: result }); } });
    });
    req.on('error', reject);
  });
}

// ── Criteria + API key loaders (talent scope) ──
function loadTalentCriteria(userId) {
  const rows = db.prepare('SELECT setting_key, setting_value FROM talent_criteria WHERE user_id = ? AND scope = ?').all(userId, 'global');
  const map = {};
  for (const row of rows) map[row.setting_key] = row.setting_value;
  const p = (v, f) => { try { return JSON.parse(v); } catch { return v || f; } };
  return {
    bands: p(map.talent_bands, ['A', 'B', 'C']),
    locations: p(map.talent_locations, []),
    schools: p(map.talent_schools, []),
    companies: p(map.talent_companies, []),
    stacks: p(map.talent_stacks, []),
    domains: p(map.talent_domains, []),
    leapSignals: p(map.talent_leap_signals, []),
    customQueries: p(map.talent_custom_queries, []),
  };
}

function loadUserApiKeys(userId) {
  const rows = db.prepare(
    "SELECT setting_key, setting_value FROM user_settings WHERE user_id = ? AND setting_key IN ('api_key_exa', 'api_key_anthropic', 'api_key_enrichlayer', 'api_key_github')"
  ).all(userId);
  const keys = {};
  for (const row of rows) keys[row.setting_key] = row.setting_value;
  return {
    exa: keys.api_key_exa || (userId === 1 ? process.env.EXA_API_KEY : null),
    anthropic: keys.api_key_anthropic || (userId === 1 ? process.env.ANTHROPIC_API_KEY : null),
    enrichlayer: keys.api_key_enrichlayer || (userId === 1 ? process.env.ENRICHLAYER_API_KEY : null),
    github: keys.api_key_github || (userId === 1 ? process.env.GITHUB_TOKEN : null),
  };
}

// ── Role loader (for role-scoped sourcing) ──
function loadRoleScope(userId, roleId) {
  if (!roleId) return null;
  const role = db.prepare(
    'SELECT id, title, band, location_pref, remote_ok, stack_requirements, domain_requirements, must_haves, nice_to_haves, portfolio_company_id FROM talent_roles WHERE id = ? AND user_id = ? AND is_deleted = 0'
  ).get(roleId, userId);
  if (!role) return null;
  const p = (v) => { try { return JSON.parse(v); } catch { return []; } };
  return {
    id: role.id,
    title: role.title,
    band: role.band || 'A',
    location_pref: role.location_pref || null,
    remote_ok: !!role.remote_ok,
    stacks: p(role.stack_requirements),
    domains: p(role.domain_requirements),
    must_haves: p(role.must_haves),
    nice_to_haves: p(role.nice_to_haves),
  };
}

// ── Location matching ──
function buildLocationTokens(locationPref) {
  if (!locationPref) return [];
  const raw = locationPref.toLowerCase();
  const tokens = new Set([raw]);
  // Chicago + IL expansion
  if (/chicago|illinois|\bil\b/.test(raw)) {
    ['chicago', 'illinois', 'evanston', 'naperville', 'oak park', 'river north', 'wicker park',
     'lincoln park', 'west loop', 'hyde park', 'schaumburg', ', il'].forEach(t => tokens.add(t));
  }
  // NYC expansion
  if (/\bnyc\b|new york|manhattan|brooklyn/.test(raw)) {
    ['new york', 'nyc', 'manhattan', 'brooklyn', 'queens', ', ny'].forEach(t => tokens.add(t));
  }
  // SF / Bay Area
  if (/san francisco|\bsf\b|bay area|palo alto|oakland/.test(raw)) {
    ['san francisco', 'sf', 'bay area', 'palo alto', 'oakland', 'berkeley', 'menlo park', ', ca'].forEach(t => tokens.add(t));
  }
  return [...tokens];
}

function matchesLocation(candidate, locationTokens) {
  if (!locationTokens.length) return true;
  const hay = [
    candidate.location_city || '',
    candidate.headline || '',
    (candidate.text || '').slice(0, 2000),
    candidate.current_location || '',
  ].join(' ').toLowerCase();
  return locationTokens.some(t => hay.includes(t));
}

// ── Query construction ──
function buildTalentQueries(criteria, fullSweep) {
  const queries = [];
  const locs = (criteria.locations || []).slice(0, 5);
  const companies = (criteria.companies || []).slice(0, 8);
  const stacks = (criteria.stacks || []).slice(0, 8);
  const domains = (criteria.domains || []).slice(0, 6);
  const bands = criteria.bands || ['A', 'B', 'C'];

  const hasLoc = locs.length > 0;
  const locSuffix = hasLoc ? ` ${locs[0]}` : '';

  // Band A — Tier-1 talent pools.
  // Strategy: don't search for "exploring" language — top engineers don't advertise that.
  // Instead, hit the institutional pools where Tier-1 Chicago engineers actually live.
  if (bands.includes('A')) {
    const loc = locs[0] || '';
    const isChicago = /chicago|illinois|\bil\b/.test(loc);

    // 1. Top CS schools — MIT/Stanford/CMU/Princeton/Harvard/Berkeley/Waterloo alums in target loc
    queries.push({ name: 'Top-CS alum in region', band: 'A', query: `site:linkedin.com/in ("MIT" OR "Stanford" OR "Carnegie Mellon" OR "Princeton" OR "Berkeley" OR "Waterloo") engineer${locSuffix}` });

    // 2. FAANG+ elite shops in target loc
    queries.push({ name: 'Ex-Google/Meta/Stripe in region', band: 'A', query: `site:linkedin.com/in ("Google" OR "Meta" OR "Stripe") "Staff Engineer" OR "Senior Engineer" OR "Founding Engineer"${locSuffix}` });
    queries.push({ name: 'Ex-OpenAI/Anthropic/Databricks', band: 'A', query: `site:linkedin.com/in ("OpenAI" OR "Anthropic" OR "Databricks" OR "Scale AI") engineer${locSuffix}` });
    queries.push({ name: 'Ex-Ramp/Brex/Plaid/Figma', band: 'A', query: `site:linkedin.com/in ("Ramp" OR "Brex" OR "Plaid" OR "Figma" OR "Vercel" OR "Linear" OR "Notion") engineer${locSuffix}` });

    // 3. Founding-engineer / YC alumni signal (the real "leap" marker)
    queries.push({ name: 'Founding engineer YC alum', band: 'A', query: `site:linkedin.com/in "Founding Engineer" OR "Founding Software Engineer" ("Y Combinator" OR "YC")${locSuffix}` });

    // 4. PhD + industry research
    queries.push({ name: 'CS PhD in industry', band: 'A', query: `site:linkedin.com/in "PhD" ("Computer Science" OR "Machine Learning") "Senior" OR "Staff" OR "Research"${locSuffix}` });

    // 5. Chicago-specific pools (only when targeting Chicago)
    if (isChicago) {
      queries.push({ name: 'UChicago CS PhD industry', band: 'A', query: `site:linkedin.com/in "University of Chicago" "PhD" ("Computer Science" OR "Machine Learning") engineer` });
      queries.push({ name: 'Northwestern CS Staff+', band: 'A', query: `site:linkedin.com/in "Northwestern" ("Staff Engineer" OR "Principal Engineer" OR "Senior Staff") Chicago` });
      queries.push({ name: 'UIUC CS top-tier', band: 'A', query: `site:linkedin.com/in "University of Illinois" ("Staff Engineer" OR "Principal") ("Google" OR "Meta" OR "Stripe") Chicago` });
      queries.push({ name: 'Early Grubhub/Groupon/Cameo senior', band: 'A', query: `site:linkedin.com/in ("Grubhub" OR "Groupon" OR "Cameo" OR "Sprout Social") "Staff" OR "Principal" OR "Senior Staff" Chicago` });
      queries.push({ name: 'Booth CS crossover', band: 'A', query: `site:linkedin.com/in "Chicago Booth" "software engineer" OR "Computer Science" engineer` });
      queries.push({ name: 'Chicago Tier-1 portfolio operator', band: 'A', query: `site:linkedin.com/in Chicago ("Sequoia" OR "Khosla" OR "a16z" OR "Benchmark") portfolio "founding engineer" OR "CTO"` });
      queries.push({ name: 'Chicago YC founding eng', band: 'A', query: `site:linkedin.com/in "Y Combinator" OR "YC W2" OR "YC S2" "founding engineer" OR "CTO" Chicago` });
    }

    // 6. User-configured company pedigree
    for (const co of companies.slice(0, 4)) {
      queries.push({ name: `Ex-${co} in region`, band: 'A', query: `site:linkedin.com/in "${co}" ("Staff" OR "Senior" OR "Principal" OR "Founding") engineer${locSuffix}` });
    }
  }

  // Band B — first-5 hire signals
  if (bands.includes('B')) {
    queries.push({ name: 'Senior engineer startup ready', band: 'B', query: `site:linkedin.com/in "senior engineer" OR "senior software engineer" "startup" "looking"${locSuffix}` });
    queries.push({ name: 'ML engineer early stage', band: 'B', query: `site:linkedin.com/in "machine learning engineer" OR "ML engineer" early-stage startup${locSuffix} 2025` });
    queries.push({ name: 'Full stack startup hire', band: 'B', query: `site:linkedin.com/in "full stack" engineer startup "seed"${locSuffix} 2025` });
    for (const stack of stacks.slice(0, 5)) {
      queries.push({ name: `${stack} engineer open`, band: 'B', query: `site:linkedin.com/in "${stack}" engineer "open to" startup early-stage${locSuffix}` });
    }
  }

  // Band C — domain expert crossover
  if (bands.includes('C')) {
    for (const domain of domains.slice(0, 4)) {
      queries.push({ name: `${domain} operator startup`, band: 'C', query: `site:linkedin.com/in "${domain}" operator "startup" OR "founding team" 10+ years${locSuffix}` });
    }
    queries.push({ name: 'Healthcare operator tech', band: 'C', query: `site:linkedin.com/in healthcare operator "technology" startup founding team${locSuffix}` });
    queries.push({ name: 'Vertical SaaS expert', band: 'C', query: `site:linkedin.com/in vertical SaaS industry expert startup founding${locSuffix}` });
  }

  // OSS maintainer signal — scoped narrower to avoid Exa 400 on mixed site: operators
  if (bands.includes('A')) {
    queries.push({ name: 'OSS maintainer in region', band: 'A', query: `site:linkedin.com/in "open source" "maintainer" OR "contributor" engineer${locSuffix}` });
  }
  if (bands.includes('B')) {
    queries.push({ name: 'Build-in-public engineer', band: 'B', query: `site:linkedin.com/in "building in public" engineer startup${locSuffix}` });
  }

  // Custom queries from user
  for (const cq of (criteria.customQueries || [])) {
    if (cq.query) queries.push({ name: cq.name || 'Custom query', query: cq.query, band: cq.band || null });
  }

  return fullSweep ? queries : queries.slice(0, 16);
}

// ── Signal extraction ──
function extractTalentSignals(text, headline, criteria) {
  const combined = ((headline || '') + ' ' + (text || '')).toLowerCase();
  const pedigree = [];
  const builder = [];
  const leap = [];
  const stack = [];

  // School pedigree
  for (const school of (criteria.schools || [])) {
    if (combined.includes(school.toLowerCase())) {
      pedigree.push(school.split(' ').map(w => w.charAt(0).toUpperCase() + w.slice(1)).join(' '));
    }
  }
  // Company pedigree
  for (const co of (criteria.companies || [])) {
    if (combined.includes(co.toLowerCase())) {
      pedigree.push('Ex-' + co.charAt(0).toUpperCase() + co.slice(1));
    }
  }
  // Stack mentions
  for (const s of (criteria.stacks || [])) {
    if (combined.includes(s.toLowerCase())) stack.push(s);
  }
  // Builder signals
  if (/open source|oss|maintainer|github/.test(combined)) builder.push('Open Source');
  if (/\bphd\b/.test(combined)) builder.push('PhD');
  if (/patent/.test(combined)) builder.push('Patent Holder');
  if (/staff engineer|principal engineer|distinguished engineer/.test(combined)) builder.push('Staff+ Engineer');
  if (/tech lead|engineering manager|eng manager/.test(combined)) builder.push('Tech Lead');
  if (/founding engineer|first engineer/.test(combined)) builder.push('Founding Engineer');
  if (/shipped|launched|built/.test(combined)) builder.push('Shipper');

  // Leap signals — critical for talent engine
  if (/open to|looking for|exploring/.test(combined)) leap.push('Open to new opportunities');
  if (/just left|recently left/.test(combined)) leap.push('Recently left');
  if (/between roles|taking a break/.test(combined)) leap.push('Between roles');
  if (/building on the side|side project/.test(combined)) leap.push('Side project builder');
  if (/advising|advisor to|angel/.test(combined)) leap.push('Advising startups');
  if (/stealth|early stage/.test(combined)) leap.push('Stealth-adjacent');
  if (/cofounder match|looking for cofounder/.test(combined)) leap.push('Cofounder-seeking');

  return {
    pedigree: [...new Set(pedigree)],
    builder: [...new Set(builder)],
    leap: [...new Set(leap)],
    stack: [...new Set(stack)],
  };
}

function inferBand(signals, yearsExperience) {
  const bands = [];
  const hasLeadership = signals.builder.some(b => ['Staff+ Engineer', 'Tech Lead', 'Founding Engineer'].includes(b));
  const hasPedigree = signals.pedigree.length >= 1;
  const hasLeap = signals.leap.length >= 1;

  // Band A reserved for tier-1 candidates only. The AI scorer has final say via tier1_ready;
  // this local fallback is conservative: only guess A when all three strong signals stack.
  if (hasLeadership && hasPedigree && hasLeap) bands.push('A');
  if (hasPedigree || hasLeadership) bands.push('B');
  if (signals.builder.includes('PhD') || signals.pedigree.length >= 2) bands.push('C');
  if (bands.length === 0) bands.push('B');
  return [...new Set(bands)];
}

// ── Exa search ──
async function searchExa(query, numResults = 20, apiKey) {
  if (!apiKey) return { results: [], error: 'No EXA_API_KEY' };
  try {
    const resp = await httpPost('https://api.exa.ai/search', { 'x-api-key': apiKey }, {
      query,
      type: 'auto',
      num_results: numResults,
      category: 'people',
      contents: { text: { max_characters: 6000 } },
    });
    if (resp.status !== 200) return { results: [], error: `Exa HTTP ${resp.status}` };
    return { results: resp.data.results || [] };
  } catch (err) {
    return { results: [], error: err.message };
  }
}

// ── GitHub user search (talent-tuned) ──
async function searchGitHubTalent(criteria, token) {
  try {
    const headers = { 'Accept': 'application/vnd.github.v3+json', 'User-Agent': 'Stu-Talent' };
    if (token) headers['Authorization'] = `token ${token}`;
    const locations = (criteria.locations || []).slice(0, 3);
    const queries = [];
    for (const loc of locations) {
      const encodedLoc = loc.includes(' ') ? `"${loc}"` : loc;
      queries.push(`location:${encodedLoc}+type:user+repos:>10+followers:>50`);
      for (const lang of ['python', 'typescript', 'rust', 'go']) {
        queries.push(`location:${encodedLoc}+type:user+language:${lang}+followers:>30`);
      }
    }
    if (locations.length === 0) {
      for (const lang of ['python', 'typescript', 'rust']) {
        queries.push(`type:user+language:${lang}+followers:>200+repos:>15`);
      }
    }

    const users = [];
    for (const q of queries.slice(0, 10)) {
      const resp = await httpGet(`https://api.github.com/search/users?q=${q}&sort=followers&order=desc&per_page=10`, headers);
      if (resp.status === 200 && resp.data.items) users.push(...resp.data.items);
    }

    return users.map(u => ({
      name: u.login,
      headline: `GitHub · ${u.login}${u.bio ? ' — ' + u.bio : ''}`,
      text: `GitHub user ${u.login}. ${u.bio || ''} Location: ${u.location || 'Unknown'}. Repos: ${u.public_repos || 0}. Followers: ${u.followers || 0}.`,
      url: u.html_url,
      linkedin_url: null,
      github_url: u.html_url,
      email: u.email || null,
      source: 'github',
      location_city: u.location,
    }));
  } catch (err) {
    console.error('[Talent][GitHub]', err.message);
    return [];
  }
}

// ── Claude scoring ──
// Tier-1 pedigree allow-lists (used for verification + instructions).
// A pedigree tag only counts if the candidate's source text contains the institution verbatim.
const TIER1_SCHOOLS = [
  'mit', 'massachusetts institute of technology',
  'stanford', 'harvard', 'princeton', 'yale',
  'caltech', 'california institute of technology',
  'carnegie mellon', 'cmu',
  'uc berkeley', 'berkeley', 'university of california, berkeley',
  'university of waterloo', 'waterloo',
  'oxford', 'cambridge', 'eth zurich', 'eth zürich',
  'imperial college', 'tsinghua', 'peking university',
  'iit bombay', 'iit delhi', 'iit madras', 'iit kanpur',
];
const TIER1_COMPANIES = [
  'google', 'meta', 'facebook', 'apple', 'amazon', 'netflix', 'microsoft',
  'stripe', 'openai', 'anthropic', 'databricks', 'nvidia', 'snowflake',
  'ramp', 'brex', 'plaid', 'figma', 'linear', 'notion', 'vercel',
  'scale ai', 'scale.ai', 'hugging face', 'huggingface',
  'palantir', 'coinbase', 'airbnb', 'uber', 'lyft', 'doordash',
  'instacart', 'roblox', 'discord', 'twitch', 'spotify',
  'waymo', 'cruise', 'tesla', 'spacex',
  'jane street', 'two sigma', 'citadel', 'drw', 'hudson river',
  'deepmind', 'google brain', 'google research', 'meta ai', 'fair',
  'y combinator', 'yc',
];

function buildTalentScoringPrompt(criteria, roleScope = null) {
  const locations = (criteria.locations || []).join(', ') || 'any location';
  const domains = (criteria.domains || []).join(', ') || 'any sector';
  const stacks = (criteria.stacks || []).join(', ') || 'any stack';

  const roleBlock = roleScope
    ? `\n\n⚠️ ROLE-SCOPED SOURCING — HARD CONSTRAINTS\nYou are sourcing specifically for this open role. Treat these as HARD requirements, not preferences:\n- Title: ${roleScope.title}\n- Band: ${roleScope.band} only\n- Location: ${roleScope.location_pref || 'any'}${roleScope.remote_ok ? ' (remote OK)' : ' — STRICT, remote NOT accepted'}\n- Required stacks: ${(roleScope.stacks || []).join(', ') || 'n/a'}\n- Required domains: ${(roleScope.domains || []).join(', ') || 'n/a'}\n- Must-haves: ${(roleScope.must_haves || []).join(', ') || 'n/a'}\n\nIf the candidate clearly fails any HARD constraint (especially location when strict), set overall_score ≤ 3, set location_match=false, and set tier1_ready=false.\n`
    : '';

  return `You are a talent scout for Superior Studios, a Chicago-based pre-seed VC.
Your job: identify Tier-1-fundable technical talent for portfolio-company hiring (founding engineer, CTO, first-5 hire). These are HIRES who would join a founding team backed by Sequoia / Khosla / Benchmark / a16z. The bar is heuristically bulletproof and impressive — if you would not stake your reputation on the intro, score accordingly.${roleBlock}

═══════ TIER-1 BAR (applies to Band A — founding engineer / CTO) ═══════
A Band-A candidate must satisfy AT LEAST TWO of these FOUR categories, with verifiable evidence:

  (P) PEDIGREE SCHOOL — verbatim attendance at a top CS/engineering program:
      MIT, Stanford, Harvard, Princeton, Yale, Caltech, CMU, UC Berkeley, Waterloo,
      Oxford/Cambridge, ETH, Imperial, Tsinghua, IIT (Bombay/Delhi/Madras/Kanpur).
      DOES NOT COUNT: "MIT Technology Review" awards, "Illinois Institute of Technology",
      "Indian Institute of Technology Chicago," visiting student programs, or any
      institution not on the list above. If unsure, exclude.

  (F) FAANG+ / ELITE STARTUP — shipped IC or staff role (NOT intern, NOT TPM, NOT short contract)
      at one of: Google/DeepMind, Meta/FAIR, Apple, Amazon (SDE III+ only, not generic SDE),
      Netflix, Microsoft Research, Stripe, OpenAI, Anthropic, Databricks, Nvidia,
      Snowflake, Ramp, Brex, Plaid, Figma, Linear, Notion, Vercel, Scale AI,
      HuggingFace, Palantir, Jane Street / Two Sigma / Citadel / DRW, Waymo,
      Airbnb (early), Uber (early), Y Combinator company (founding or early).
      Tenure must be ≥18 months unless role was "Founding Engineer."
      DOES NOT COUNT: AWS generic SDE, contractor, internship, TPM, PM.

  (L) PRIOR TIER-1 FOUNDER — raised from Sequoia/Khosla/Benchmark/a16z/Founders
      Fund/Accel/Greylock/Index/YC, OR had meaningful exit ($50M+ acquisition,
      IPO as founder/early exec).

  (R) RESEARCH/OSS EMINENCE — PhD from top-10 CS program + cited papers, OR
      widely-used OSS project (>2k GitHub stars as owner/maintainer), OR
      invited speaker at top conference (NeurIPS, ICML, Strange Loop, KubeCon keynote).

═══════ SENIORITY vs. STAGE FIT (Band-A gate) ═══════
Cofounder/CTO candidates must be PRE-PEAKED, not POST-PEAKED.
- SWEET SPOT: 7–14 years experience, currently Senior/Staff IC or Founding Engineer.
- PENALIZE heavily (Band A → False): 18+ year VPs, Sr. Directors at public cos,
  Principal Engineers at 30-yr career, anyone who would take a massive title/pay cut
  and statistically won't make the leap. These are NOT founding-stage material.
- SCORE HIGHER: 5–10 year engineers with founding-eng or early-employee-at-scaled-startup
  history (they've seen 0→1 and are hungry).

═══════ SUB-SCORES (1–10 each, return all four) ═══════
1. BUILD CALIBER (40%) — 9–10 only if (P)+(F) or (F)+(R); 7–8 if one strong category; ≤5 otherwise
2. LEAP READINESS (25%) — 2–4yr tenure + restless signals = 8+; just promoted or 6mo in = ≤4
3. DOMAIN FIT (20%) — match to target stacks: ${stacks}; domains: ${domains}
4. GEOGRAPHY (15%) — target: ${locations}; remote OK unless role is strict-location

═══════ TIER-1 READINESS (boolean gate) ═══════
Set tier1_ready = true ONLY IF:
  - At least TWO of (P/F/L/R) are satisfied with verbatim evidence from profile text, AND
  - Seniority vs. stage is appropriate (not a 20-yr post-peak VP), AND
  - overall_score ≥ 7, AND
  - No disqualifying red flags (fake resume, vanity CTO of 1-person LLC, TPM/PM masquerading as engineer).

If tier1_ready = false, DO NOT include "A" in band_fit.

═══════ ANTI-HALLUCINATION RULES ═══════
- Every item in "pedigree_signals" MUST have a matching "pedigree_evidence" quote
  (verbatim substring from the profile text, ≤120 chars) justifying it.
- If you can't quote the evidence, DROP the pedigree tag.
- NEVER tag "MIT" because the profile mentions "MIT Technology Review," "TR35," a
  partner/collaborator at MIT, or any school whose name contains "Institute of Technology."
- NEVER tag "Ex-Google" for a candidate who only lists Google as a partner, client,
  or customer — they must have worked there.
- "Staff Engineer" at a no-name company is NOT a pedigree signal.

Return ONLY valid JSON:
{
  "score_build_caliber": <1-10>,
  "score_leap_readiness": <1-10>,
  "score_domain_fit": <1-10>,
  "score_geography": <1-10>,
  "overall_score": <1-10 weighted composite — do not inflate>,
  "score_rationale": "<2-3 sentences, specific. Cite which of P/F/L/R are satisfied.>",
  "tier1_ready": <true | false>,
  "tier1_categories": ["<P|F|L|R — categories satisfied with evidence>"],
  "tech_stack": ["<inferred primary stacks>"],
  "pedigree_signals": ["<verified school/company tags only>"],
  "pedigree_evidence": {"<pedigree_tag>": "<verbatim quote from profile, ≤120 chars>"},
  "builder_signals": ["<evidence of shipping>"],
  "leap_signals": ["<why they might leap, or empty if they won't>"],
  "band_fit": ["<A | B | C — A ONLY if tier1_ready=true>"],
  "one_liner": "<who they are in one line>",
  "years_experience": <integer or null>,
  "current_company": "<string or null>",
  "current_role": "<string or null>",
  "current_location": "<city, state/region — extract from profile — or null if truly unknown>",
  "location_match": <true | false — satisfies target location?>,
  "red_flags": ["<any disqualifying issue: vanity title, suspicious resume, etc.>"]
}`;
}

async function scoreCandidate(client, candidate, scoringPrompt) {
  try {
    const response = await client.messages.create({
      model: 'claude-sonnet-4-20250514',
      max_tokens: 900,
      system: scoringPrompt,
      messages: [{
        role: 'user',
        content: `Score this candidate:\n\nName: ${candidate.name}\nHeadline: ${candidate.headline || 'N/A'}\nLinkedIn: ${candidate.linkedin_url || 'N/A'}\nGitHub: ${candidate.github_url || 'N/A'}\nSource: ${candidate.source}\n\nProfile text:\n${(candidate.text || '').slice(0, 4000)}`
      }]
    });
    const text = response.content[0].text.trim();
    const match = text.match(/\{[\s\S]*\}/);
    if (match) {
      const p = JSON.parse(match[0]);
      return {
        score_build_caliber: p.score_build_caliber || 5,
        score_leap_readiness: p.score_leap_readiness || 5,
        score_domain_fit: p.score_domain_fit || 5,
        score_geography: p.score_geography || 5,
        overall_score: p.overall_score || 5,
        score_rationale: p.score_rationale || '',
        tier1_ready: p.tier1_ready === true,
        tier1_categories: Array.isArray(p.tier1_categories) ? p.tier1_categories : [],
        tech_stack: p.tech_stack || [],
        pedigree_signals: p.pedigree_signals || [],
        pedigree_evidence: (p.pedigree_evidence && typeof p.pedigree_evidence === 'object') ? p.pedigree_evidence : {},
        builder_signals: p.builder_signals || [],
        leap_signals: p.leap_signals || [],
        band_fit: p.band_fit || ['B'],
        one_liner: p.one_liner || '',
        years_experience: p.years_experience || null,
        current_company: p.current_company || null,
        current_role: p.current_role || null,
        current_location: p.current_location || null,
        location_match: p.location_match !== false,
        red_flags: Array.isArray(p.red_flags) ? p.red_flags : [],
      };
    }
  } catch (err) {
    console.error('[Talent][Score]', err.message);
  }
  return {
    score_build_caliber: 5, score_leap_readiness: 5, score_domain_fit: 5, score_geography: 5,
    overall_score: 5, score_rationale: 'Scoring unavailable',
    tier1_ready: false, tier1_categories: [],
    tech_stack: [], pedigree_signals: [], pedigree_evidence: {}, builder_signals: [], leap_signals: [], band_fit: ['B'],
    one_liner: '', years_experience: null, current_company: null, current_role: null,
    current_location: null, location_match: true, red_flags: [],
  };
}

// Verify each pedigree tag has verbatim evidence in the source text.
// Drops tags without evidence and tags that map to disallowed institutions
// (e.g. "Illinois Institute of Technology" tagged as "MIT").
function verifyPedigree(score, sourceText) {
  const hay = (sourceText || '').toLowerCase();
  const keep = [];
  for (const tag of (score.pedigree_signals || [])) {
    const evidence = (score.pedigree_evidence && score.pedigree_evidence[tag]) || '';
    const tagLower = tag.toLowerCase();

    // Hard rule: MIT tag requires literal "MIT" or "massachusetts institute of technology"
    // appearing in the source AND the evidence quote. Reject if only "Institute of Technology"
    // is present (IIT, Georgia Tech, etc.).
    if (/\bmit\b/.test(tagLower) || tagLower.includes('massachusetts')) {
      const mitInSource = /\bmit\b/.test(hay) || hay.includes('massachusetts institute of technology');
      const notInstTech = !/illinois institute of technology|indian institute of technology|georgia institute of technology|rochester institute of technology|stevens institute of technology/.test(hay.slice(0, 500).replace(/\bmit\b/g, 'XXX'));
      if (!mitInSource) continue; // fabricated MIT
    }

    // Evidence must appear verbatim in source (case-insensitive)
    if (evidence && hay.includes(evidence.toLowerCase().slice(0, 60))) {
      keep.push(tag);
      continue;
    }
    // Fallback: the tag's core keyword appears in the source
    const core = tagLower.replace(/^ex-|^university of |^uc /, '').slice(0, 30);
    if (core.length >= 3 && hay.includes(core)) {
      keep.push(tag);
    }
  }
  return keep;
}

// ── Dedupe ──
function isDuplicate(candidate, userId) {
  if (candidate.linkedin_url) {
    const slug = candidate.linkedin_url.replace(/\/$/, '').toLowerCase().split('/in/')[1] || candidate.linkedin_url.toLowerCase();
    const row = db.prepare('SELECT id FROM talent_candidates WHERE LOWER(linkedin_url) LIKE ? AND user_id = ? AND is_deleted = 0').get(`%${slug}%`, userId);
    if (row) return true;
  }
  if (candidate.github_url) {
    const row = db.prepare('SELECT id FROM talent_candidates WHERE LOWER(github_url) = LOWER(?) AND user_id = ? AND is_deleted = 0').get(candidate.github_url, userId);
    if (row) return true;
  }
  if (candidate.email) {
    const row = db.prepare('SELECT id FROM talent_candidates WHERE LOWER(email) = LOWER(?) AND user_id = ? AND is_deleted = 0').get(candidate.email, userId);
    if (row) return true;
  }
  return false;
}

// ── Main engine ──
async function runTalentEngine({ userId = 1, fullSweep = false, roleId = null } = {}) {
  const roleScope = loadRoleScope(userId, roleId);
  const strictLocation = !!(roleScope && roleScope.location_pref && !roleScope.remote_ok);
  const locationTokens = strictLocation ? buildLocationTokens(roleScope.location_pref) : [];

  console.log(`[TalentEngine] Start (user ${userId}, mode: ${fullSweep ? 'FULL' : 'daily'}${roleScope ? `, role: ${roleScope.id} "${roleScope.title}"` : ''}${strictLocation ? `, strict location: ${roleScope.location_pref}` : ''})`);

  const criteria = loadTalentCriteria(userId);
  // Apply role-scoped overrides
  if (roleScope) {
    criteria.bands = [roleScope.band];
    if (roleScope.location_pref) {
      criteria.locations = [roleScope.location_pref.toLowerCase()];
    }
    // Union role stacks/domains with criteria (role requirements take precedence)
    if (roleScope.stacks?.length) criteria.stacks = [...new Set([...roleScope.stacks, ...(criteria.stacks || [])])];
    if (roleScope.domains?.length) criteria.domains = [...new Set([...roleScope.domains, ...(criteria.domains || [])])];
  }

  const apiKeys = loadUserApiKeys(userId);

  if (!apiKeys.exa) {
    console.log('[TalentEngine] No Exa API key — aborting');
    return { candidatesFound: 0, candidatesAdded: 0, error: 'No Exa API key configured' };
  }

  const run = db.prepare('INSERT INTO talent_sourcing_runs (user_id, sources_hit) VALUES (?, ?)').run(userId, JSON.stringify([]));
  const runId = run.lastInsertRowid;

  const sourcesHit = [];
  const errors = [];
  let found = 0, added = 0, deduped = 0;

  const candidates = [];

  // Phase 1: Exa
  const queries = buildTalentQueries(criteria, fullSweep);
  console.log(`[TalentEngine] Running ${queries.length} Exa queries`);

  for (const q of queries) {
    const { results, error } = await searchExa(q.query, fullSweep ? 30 : 15, apiKeys.exa);
    if (error) { errors.push({ q: q.name, error }); continue; }
    sourcesHit.push(`exa:${q.name}`);

    for (const r of results) {
      const headline = r.title || '';
      const text = r.text || '';
      const url = r.url || '';
      const isLI = url.includes('linkedin.com/in/');
      let name = headline.split(/[|·—\-]/)[0].trim();
      if (name.length > 60) name = name.slice(0, 60);
      if (!name || name.length < 2) continue;

      candidates.push({
        name,
        headline: headline.slice(0, 500),
        text: text.slice(0, 6000),
        linkedin_url: isLI ? url : null,
        github_url: null,
        email: null,
        source: 'exa',
        search_query: q.name,
        search_band_hint: q.band,
      });
    }
    found += results.length;
  }

  // Phase 2: GitHub
  const gh = await searchGitHubTalent(criteria, apiKeys.github);
  console.log(`[TalentEngine] GitHub found ${gh.length}`);
  sourcesHit.push('github');
  for (const g of gh) {
    candidates.push({ ...g, search_query: 'github', search_band_hint: null });
  }
  found += gh.length;

  // Phase 3: Dedup
  const seen = new Set();
  const unique = [];
  for (const c of candidates) {
    const key = c.linkedin_url || c.github_url || c.name;
    const keyLower = (key || '').toLowerCase();
    if (seen.has(keyLower)) { deduped++; continue; }
    seen.add(keyLower);
    if (isDuplicate(c, userId)) { deduped++; continue; }
    unique.push(c);
  }
  console.log(`[TalentEngine] ${unique.length} unique to score (${deduped} deduped)`);

  // Phase 4: Score with Claude
  let anthropic = null;
  if (apiKeys.anthropic) {
    try {
      const Anthropic = require('@anthropic-ai/sdk');
      anthropic = new Anthropic({ apiKey: apiKeys.anthropic });
    } catch {}
  }
  const prompt = buildTalentScoringPrompt(criteria, roleScope);
  const insert = db.prepare(`
    INSERT INTO talent_candidates (
      user_id, name, headline, linkedin_url, github_url, email,
      current_company, current_role, years_experience,
      location_city, tech_stack, pedigree_signals, builder_signals, leap_signals,
      band_fit, score_build_caliber, score_leap_readiness, score_domain_fit,
      score_geography, overall_score, score_rationale, one_liner,
      source, search_query, raw_data
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);

  let rejectedByLocation = 0;
  let rejectedByBand = 0;
  let rejectedByTier1 = 0;
  let rejectedByScore = 0;
  const bandAMode = roleScope ? roleScope.band === 'A' : (criteria.bands || []).includes('A');
  const TIER1_MIN_SCORE = bandAMode ? 7 : 6;
  for (const c of unique) {
    const localSignals = extractTalentSignals(c.text, c.headline, criteria);

    let score = {
      score_build_caliber: 5, score_leap_readiness: 5, score_domain_fit: 5, score_geography: 5,
      overall_score: 5, score_rationale: 'AI scoring unavailable',
      tier1_ready: false, tier1_categories: [],
      tech_stack: localSignals.stack, pedigree_signals: localSignals.pedigree, pedigree_evidence: {},
      builder_signals: localSignals.builder, leap_signals: localSignals.leap,
      band_fit: inferBand(localSignals),
      one_liner: '', years_experience: null, current_company: null, current_role: null,
      current_location: null, location_match: true, red_flags: [],
    };
    if (anthropic) score = await scoreCandidate(anthropic, c, prompt);

    // Verify pedigree — drop hallucinated tags (e.g. fake "MIT")
    score.pedigree_signals = verifyPedigree(score, c.text || '');

    // Hard location filter — role-scoped + strict location
    if (strictLocation) {
      const candLocCheck = { ...c, current_location: score.current_location };
      const aiSaysMatch = score.location_match !== false;
      const textMatch = matchesLocation(candLocCheck, locationTokens);
      if (!aiSaysMatch && !textMatch) {
        rejectedByLocation++;
        console.log(`[TalentEngine] 🚫 ${c.name} → skipped: not in ${roleScope.location_pref} (AI says: ${score.current_location || 'unknown'})`);
        continue;
      }
    }

    // Hard band filter — role-scoped
    if (roleScope && Array.isArray(score.band_fit) && score.band_fit.length && !score.band_fit.includes(roleScope.band)) {
      rejectedByBand++;
      console.log(`[TalentEngine] 🚫 ${c.name} → skipped: band ${score.band_fit.join(',')} ≠ ${roleScope.band}`);
      continue;
    }

    // Hard Tier-1 gate — Band A candidates must pass tier1_ready and min score
    if (bandAMode) {
      if (!score.tier1_ready) {
        rejectedByTier1++;
        console.log(`[TalentEngine] 🚫 ${c.name} → skipped: not tier-1 ready (cats: ${(score.tier1_categories||[]).join(',') || 'none'}, flags: ${(score.red_flags||[]).join('; ') || 'none'})`);
        continue;
      }
      if (score.overall_score < TIER1_MIN_SCORE) {
        rejectedByScore++;
        console.log(`[TalentEngine] 🚫 ${c.name} → skipped: score ${score.overall_score} < ${TIER1_MIN_SCORE}`);
        continue;
      }
    }

    // Merge local + AI signals (pedigree already verified above)
    const mergeArr = (a, b) => [...new Set([...(a || []), ...(b || [])])];
    const pedigree = score.pedigree_signals; // verified, do not re-merge local (avoids re-injecting hallucinated tags)
    const builder = mergeArr(localSignals.builder, score.builder_signals);
    const leap = mergeArr(localSignals.leap, score.leap_signals);
    const stack = mergeArr(localSignals.stack, score.tech_stack);

    try {
      insert.run(
        userId, c.name, c.headline || null, c.linkedin_url || null, c.github_url || null, c.email || null,
        score.current_company, score.current_role, score.years_experience,
        c.location_city || score.current_location || null, JSON.stringify(stack), JSON.stringify(pedigree),
        JSON.stringify(builder), JSON.stringify(leap),
        JSON.stringify(score.band_fit),
        score.score_build_caliber, score.score_leap_readiness, score.score_domain_fit,
        score.score_geography, score.overall_score, score.score_rationale,
        score.one_liner, c.source, c.search_query,
        JSON.stringify({ headline: c.headline, text: (c.text || '').slice(0, 2000) })
      );
      added++;
      console.log(`[TalentEngine] ${score.overall_score >= 8 ? '🔥' : score.overall_score >= 6 ? '✅' : '📝'} ${c.name} → ${score.overall_score}/10 [bands: ${(score.band_fit || []).join(',')}]`);
    } catch (err) {
      errors.push({ name: c.name, error: err.message });
    }
  }

  // Phase 5: auto-match new candidates against open roles (or just this role)
  let matchesCreated = 0;
  if (added > 0) {
    try {
      const { runMatchEngine } = require('./match-engine');
      const result = await runMatchEngine({ userId, onlyNewCandidates: true, roleId: roleScope?.id });
      matchesCreated = result.matches_created || 0;
    } catch (err) {
      errors.push({ stage: 'match', error: err.message });
    }
  }

  // Update run log
  db.prepare('UPDATE talent_sourcing_runs SET sources_hit = ?, candidates_found = ?, candidates_added = ?, candidates_deduplicated = ?, matches_generated = ?, errors = ? WHERE id = ?').run(
    JSON.stringify(sourcesHit), found, added, deduped, matchesCreated, JSON.stringify(errors), runId
  );

  const rejectedBits = [];
  if (rejectedByLocation) rejectedBits.push(`${rejectedByLocation} loc`);
  if (rejectedByBand) rejectedBits.push(`${rejectedByBand} band`);
  if (rejectedByTier1) rejectedBits.push(`${rejectedByTier1} tier1`);
  if (rejectedByScore) rejectedBits.push(`${rejectedByScore} score`);
  const rejectedStr = rejectedBits.length ? `, rejected: ${rejectedBits.join(' + ')}` : '';
  console.log(`[TalentEngine] ✅ ${found} found → ${added} added, ${deduped} deduped${rejectedStr}, ${matchesCreated} matches generated, ${errors.length} errors`);
  return { candidatesFound: found, candidatesAdded: added, candidatesDeduped: deduped, rejectedByLocation, rejectedByBand, rejectedByTier1, rejectedByScore, matchesCreated, errors };
}

module.exports = { runTalentEngine };
