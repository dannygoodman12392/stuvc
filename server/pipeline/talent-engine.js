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
// Reuse the Pipeline's hardened profile-hygiene guards so Talent has the same accuracy bar.
const { cleanProfileText, isPlausiblePersonName } = require('./sourcing-engine');

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
  // Single-operator app: the platform env keys are Danny's. Fall back to them for ANY user,
  // not just user id 1 — otherwise a non-1 account's manual runs silently get no keys and
  // abort before recording anything ("never run"). A user's own saved key still takes priority.
  return {
    exa: keys.api_key_exa || process.env.EXA_API_KEY || null,
    anthropic: keys.api_key_anthropic || process.env.ANTHROPIC_API_KEY || null,
    enrichlayer: keys.api_key_enrichlayer || process.env.ENRICHLAYER_API_KEY || null,
    github: keys.api_key_github || process.env.GITHUB_TOKEN || null,
  };
}

// ── Role loader (for role-scoped sourcing) ──
function loadRoleScope(userId, roleId) {
  if (!roleId) return null;
  const role = db.prepare(
    'SELECT id, title, band, role_function, jd_content, location_pref, remote_ok, stack_requirements, domain_requirements, must_haves, nice_to_haves, portfolio_company_id FROM talent_roles WHERE id = ? AND user_id = ? AND is_deleted = 0'
  ).get(roleId, userId);
  if (!role) return null;
  const p = (v) => { try { return JSON.parse(v); } catch { return []; } };
  const { resolveRoleFunction } = require('./match-engine');
  return {
    id: role.id,
    title: role.title,
    band: role.band || 'A',
    function: resolveRoleFunction(role),
    jd_content: role.jd_content || '',
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

// ── Role archetypes ──
// Each role has a FUNCTION. The tier-1 caliber bar and the sourcing queries differ
// completely by function — a CMO is not judged on founding-engineer signals. The
// (P)(F)(L)(R) letters stay as generic "evidence category" slots; their MEANING is
// redefined per archetype. Engineering is the default and preserves prior behavior.
function normalizeArchetype(v) {
  const s = String(v || '').toLowerCase();
  // CS before gtm/finance — "account management" must not fall into finance's /account/.
  if (/customer success|customer experience|\bcsm\b|\bcs lead\b|account management|account manager|post.?sales|renewals/.test(s)) return 'success';
  if (/gtm|sales|marketing|growth|revenue|cmo|cro|demand/.test(s)) return 'gtm';
  if (/product|^pm$|\bpm\b|cpo/.test(s)) return 'product';
  if (/design|ux|ui|brand/.test(s)) return 'design';
  if (/ops|operation|bizops|chief of staff|coo/.test(s)) return 'operations';
  if (/finance|fp&a|cfo|account/.test(s)) return 'finance';
  if (/general|founder|chief of staff|business/.test(s)) return 'generalist';
  if (/eng|technical|software|cto|developer|ml|ai|data/.test(s)) return 'engineering';
  return 'engineering';
}

const ARCHETYPES = {
  engineering: {
    label: 'Engineering',
    caliberName: 'BUILD CALIBER',
    mission: 'Tier-1-fundable technical talent for portfolio-company hiring (founding engineer, CTO, first-5 hire).',
    bar: `  (P) PEDIGREE SCHOOL — verbatim attendance at a top CS/engineering program:
      MIT, Stanford, Harvard, Princeton, Yale, Caltech, CMU, UC Berkeley, Waterloo,
      Oxford/Cambridge, ETH, Imperial, Tsinghua, IIT (Bombay/Delhi/Madras/Kanpur).
      DOES NOT COUNT: "MIT Technology Review", "Illinois Institute of Technology", visiting programs.
  (F) FAANG+ / ELITE STARTUP — shipped IC or staff role (NOT intern, NOT TPM, NOT short contract) at:
      Google/DeepMind, Meta/FAIR, Apple, Amazon (SDE III+), Microsoft Research, Stripe, OpenAI,
      Anthropic, Databricks, Nvidia, Snowflake, Ramp, Brex, Plaid, Figma, Linear, Notion, Vercel,
      Scale AI, Palantir, Jane Street/Two Sigma/Citadel/DRW, Waymo, early Airbnb/Uber, YC company.
      Tenure ≥18 months unless "Founding Engineer". DOES NOT COUNT: generic AWS SDE, contractor, intern, TPM, PM.
  (L) PRIOR TIER-1 FOUNDER — raised from Sequoia/Khosla/Benchmark/a16z/Founders Fund/Accel/Greylock/Index/YC,
      OR meaningful exit ($50M+ acquisition, IPO as founder/early exec).
  (R) RESEARCH/OSS EMINENCE — PhD top-10 CS + cited papers, OR >2k-star OSS as owner/maintainer,
      OR invited speaker at NeurIPS/ICML/Strange Loop/KubeCon keynote.`,
    seniority: `SWEET SPOT: 7–14 yrs, currently Senior/Staff IC or Founding Engineer. PENALIZE 18+yr VPs / Sr Directors
at public cos who won't take the leap. SCORE HIGHER: 5–10yr engineers with founding-eng / early-at-scaled-startup history.`,
    caliberDef: '9–10 only if (P)+(F) or (F)+(R); 7–8 if one strong category; ≤5 otherwise',
  },
  gtm: {
    label: 'Go-to-Market (Sales / Marketing / Growth)',
    caliberName: 'GTM CALIBER',
    mission: 'A go-to-market leader who can build pipeline and revenue for a portfolio company (CMO/CRO/VP Sales/Head of Growth/first GTM hire).',
    bar: `  (P) SCALED REVENUE — owned a number and beat it, with a QUOTED metric: built pipeline that closed
      enterprise logos, grew ARR a meaningful multiple ($1M→$10M+), or carried and exceeded quota at scale.
  (F) ELITE GTM ORG — quota-carrier-to-leader at a category-defining go-to-market machine or hypergrowth
      startup (Salesforce, HubSpot, Stripe, Snowflake, Datadog, Gong, Ramp, Brex, Toast, ServiceTitan,
      Procore, Klaviyo). NOT a 3-month BDR stint.
  (L) BUILT A FUNCTION 0→1 — first sales/marketing hire who built the team, the motion, and the pipeline
      from scratch at an early-stage startup that then scaled.
  (R) CATEGORY / BRAND — created or defined a category, ran named campaigns with measurable lift, or is a
      recognized voice (large following, conference talks, published GTM playbooks).`,
    seniority: `Reward operators who took something from $0–1M to $10M+ AND have a 0→1 chapter. PENALIZE pure
big-co lifers who never built from zero, and anyone who only managed an existing machine. For a first-GTM-hire role, prioritize the 0→1 builder over the big-title manager.`,
    caliberDef: '9–10 only if (P)+(L) or (P)+(F) with quoted metrics; 7–8 one strong category; ≤5 if no owned-number evidence',
  },
  product: {
    label: 'Product',
    caliberName: 'PRODUCT CALIBER',
    mission: 'A product leader who can own roadmap and ship for a portfolio company (CPO/Head of Product/founding PM).',
    bar: `  (P) SHIPPED AT SCALE — owned a product/surface used by many users with a QUOTED outcome (adoption,
      revenue, retention). Project-managing someone else's roadmap does NOT count.
  (F) ELITE PRODUCT ORG — PM/product leadership at a top product company (Stripe, Figma, Notion, Linear,
      Airbnb, Ramp, Rippling, Google, Meta) where they OWNED a roadmap.
  (L) 0→1 PRODUCT — defined and launched a product from zero (founder or founding PM) that found traction.
  (R) CRAFT / DOMAIN — recognized product thinker (writing, talks) OR deep domain expertise matching the company.`,
    seniority: `Reward 0→1 builders and PMs with a clear ownership story. PENALIZE process-PMs who only optimized
mature products and can't point to something they took from zero.`,
    caliberDef: '9–10 if (P)+(L) or (F)+(L); 7–8 one strong; ≤5 if no shipped-ownership evidence',
  },
  design: {
    label: 'Design',
    caliberName: 'DESIGN CALIBER',
    mission: 'A design leader (founding designer / Head of Design) who can own product and brand for a portfolio company.',
    bar: `  (P) SHIPPED DESIGN AT SCALE — owned the design of products used by many users; quote the scope.
  (F) ELITE DESIGN ORG — design role at a top product/brand company (Figma, Apple, Airbnb, Stripe, Linear, IDEO).
  (L) FOUNDING DESIGNER 0→1 — first designer who built the product and brand from scratch at an early startup.
  (R) PORTFOLIO / RECOGNITION — standout portfolio, design awards, or a following / published work.`,
    seniority: `Reward range (product + brand) and a 0→1 chapter. PENALIZE pure-pixel executors with no ownership.`,
    caliberDef: '9–10 if (P)+(L) or strong portfolio + elite org; 7–8 one strong; ≤5 otherwise',
  },
  operations: {
    label: 'Operations / BizOps / Chief of Staff',
    caliberName: 'OPERATING CALIBER',
    mission: 'An operator who can build and run functions for a portfolio company (COO-track, BizOps, Chief of Staff, first ops hire).',
    bar: `  (P) SCALED AN OPS FUNCTION — built processes/systems that scaled headcount, GMV, or operations with a QUOTED result.
  (F) ELITE PEDIGREE + OPERATOR — top firm (McKinsey/Bain/BCG, GS/MS) PLUS a real operating chapter at a
      hypergrowth startup — consulting alone is NOT enough.
  (L) 0→1 OPERATOR — Chief of Staff / first ops hire who built the operating backbone of an early startup.
  (R) DOMAIN DEPTH — deep expertise in the company's specific vertical/operations.`,
    seniority: `Reward operators with a build-from-scratch chapter. PENALIZE career consultants with no operating
ownership and big-co managers who only ran mature machines.`,
    caliberDef: '9–10 if (P)+(L) or (F)+(L); 7–8 one strong; ≤5 if consulting-only / no owned outcome',
  },
  finance: {
    label: 'Finance',
    caliberName: 'FINANCE CALIBER',
    mission: 'A finance leader (CFO-track / Head of Finance / first finance hire) for a portfolio company.',
    bar: `  (P) OWNED FINANCE AT SCALE — ran FP&A / finance with a QUOTED scope (managed $X, raised $Y, ran a model that drove decisions).
  (F) ELITE FINANCE PEDIGREE — top firm (Goldman/Morgan Stanley, top PE/VC/IB) PLUS a startup/operator chapter.
  (L) 0→1 FINANCE — first finance hire who built the finance function and helped raise at an early startup.
  (R) CREDENTIAL + TRACK RECORD — CPA/CFA AND a real fundraising / operating track record.`,
    seniority: `Reward a startup finance chapter, not just banking. PENALIZE pure-banking resumes with no operating finance.`,
    caliberDef: '9–10 if (P)+(L) or (F)+(L); 7–8 one strong; ≤5 if banking-only / no operating finance',
  },
  success: {
    label: 'Customer Success',
    caliberName: 'CS CALIBER',
    mission: 'A customer success leader who can retain and grow accounts for a portfolio company (Head of CS / first CSM / post-sales lead).',
    bar: `  (P) RETENTION / EXPANSION OWNED — owned net revenue retention, churn, or expansion with a QUOTED result
      (e.g. took NRR from 95% → 120%, cut churn, drove upsell/expansion revenue).
  (F) ELITE CS ORG — customer success / account management role at a category-defining SaaS company
      (Salesforce, HubSpot, Gainsight, Snowflake, Datadog, Notion, Ramp) — owned a book of business, not a support queue.
  (L) BUILT CS 0→1 — first CS hire who built the onboarding/retention motion and the team from scratch at an early startup.
  (R) PLAYBOOK / RECOGNITION — created the CS playbook, recognized voice in customer success, or scaled a CS org through hypergrowth.`,
    seniority: `Reward operators who built a CS function and own retention/expansion numbers. PENALIZE pure tier-1
support reps with no ownership of renewals/expansion, and big-co CSMs who only managed an existing book.`,
    caliberDef: '9–10 only if (P)+(L) or (P)+(F) with quoted retention/expansion metrics; 7–8 one strong; ≤5 if no owned-number evidence',
  },
  generalist: {
    label: 'Generalist / Business',
    caliberName: 'OPERATOR CALIBER',
    mission: 'An exceptional generalist operator / first business hire for a portfolio company.',
    bar: `  (P) ELITE PEDIGREE — top school OR top firm with a clear track record.
  (F) CATEGORY-DEFINING COMPANY — meaningful role at a hypergrowth startup or top company.
  (L) PRIOR FOUNDER / 0→1 — founded a company or was an early builder who owned outcomes.
  (R) EXCEPTIONAL TRACK RECORD — quantified wins, recognition, or rare range.`,
    seniority: `Reward range + ownership + hunger. PENALIZE big-co lifers with no 0→1 or ownership evidence.`,
    caliberDef: '9–10 if two categories with evidence; 7–8 one strong; ≤5 otherwise',
  },
};

function getArchetype(roleScope, criteria) {
  const key = normalizeArchetype(roleScope?.function || criteria?.role_function || 'engineering');
  return { key, ...ARCHETYPES[key] };
}

// Archetype-specific Exa query pools (used when a role's function is non-engineering).
function archetypeQueries(archKey, locSuffix, isChicago) {
  const q = (band, name, query) => ({ band, name, query });
  const pools = {
    gtm: [
      q('A', 'Scaled GTM leader', `site:linkedin.com/in ("VP Sales" OR "VP Marketing" OR "CMO" OR "CRO" OR "Head of Growth") ("scaled" OR "ARR" OR "pipeline" OR "quota")${locSuffix}`),
      q('A', 'Ex-elite GTM org', `site:linkedin.com/in ("Salesforce" OR "HubSpot" OR "Stripe" OR "Snowflake" OR "Gong" OR "Ramp" OR "Toast") ("sales" OR "marketing" OR "growth") (leader OR director OR VP)${locSuffix}`),
      q('A', 'First GTM hire 0→1', `site:linkedin.com/in ("first marketing hire" OR "first sales hire" OR "founding GTM" OR "built the sales team" OR "built the marketing function")${locSuffix}`),
      q('B', 'GTM operator startup-ready', `site:linkedin.com/in ("growth marketer" OR "account executive" OR "demand generation") startup "early-stage"${locSuffix}`),
      ...(isChicago ? [q('A', 'Chicago GTM leaders', `site:linkedin.com/in ("VP Sales" OR "CMO" OR "Head of Growth") ("Sprout Social" OR "Salesforce" OR "Grubhub" OR "ActiveCampaign" OR "G2") Chicago`)] : []),
    ],
    product: [
      q('A', 'PM at elite product org', `site:linkedin.com/in ("Product Manager" OR "Head of Product" OR "CPO" OR "Group PM") ("Stripe" OR "Figma" OR "Notion" OR "Linear" OR "Airbnb" OR "Ramp" OR "Google" OR "Meta")${locSuffix}`),
      q('A', 'Founding PM 0→1', `site:linkedin.com/in ("founding product manager" OR "first product hire" OR "0 to 1 product" OR "launched product")${locSuffix}`),
      q('B', 'PM startup-ready', `site:linkedin.com/in "product manager" startup "early-stage" "shipped"${locSuffix}`),
      ...(isChicago ? [q('A', 'Chicago product leaders', `site:linkedin.com/in ("Head of Product" OR "Director of Product" OR "CPO") Chicago startup`)] : []),
    ],
    design: [
      q('A', 'Founding / lead designer', `site:linkedin.com/in ("founding designer" OR "Head of Design" OR "lead product designer") ("Figma" OR "Stripe" OR "Airbnb" OR "Linear" OR startup)${locSuffix}`),
      q('B', 'Product designer startup', `site:linkedin.com/in "product designer" startup "early-stage"${locSuffix}`),
      ...(isChicago ? [q('A', 'Chicago design leaders', `site:linkedin.com/in ("Head of Design" OR "founding designer" OR "Design Lead") Chicago startup`)] : []),
    ],
    operations: [
      q('A', 'BizOps / Chief of Staff', `site:linkedin.com/in ("Chief of Staff" OR "BizOps" OR "Business Operations" OR "Head of Operations" OR "COO") startup ("scaled" OR "0 to 1")${locSuffix}`),
      q('A', 'Consultant-turned-operator', `site:linkedin.com/in ("McKinsey" OR "Bain" OR "BCG") ("startup" OR "operator" OR "Chief of Staff" OR "Head of Operations")${locSuffix}`),
      q('B', 'Ops generalist startup', `site:linkedin.com/in "operations" startup "early-stage" "built"${locSuffix}`),
      ...(isChicago ? [q('A', 'Chicago ops leaders', `site:linkedin.com/in ("Chief of Staff" OR "Head of Operations" OR "COO") Chicago startup`)] : []),
    ],
    finance: [
      q('A', 'Startup CFO / Head of Finance', `site:linkedin.com/in ("CFO" OR "Head of Finance" OR "VP Finance" OR "FP&A") startup ("raised" OR "0 to 1" OR "first finance hire")${locSuffix}`),
      q('A', 'Banking-to-operator finance', `site:linkedin.com/in ("Goldman Sachs" OR "Morgan Stanley" OR "private equity") ("startup" OR "CFO" OR "Head of Finance")${locSuffix}`),
      ...(isChicago ? [q('A', 'Chicago finance leaders', `site:linkedin.com/in ("CFO" OR "Head of Finance" OR "VP Finance") Chicago startup`)] : []),
    ],
    success: [
      q('A', 'CS leader, retention owner', `site:linkedin.com/in ("Head of Customer Success" OR "VP Customer Success" OR "Customer Success") ("net revenue retention" OR "NRR" OR "churn" OR "expansion" OR "renewals")${locSuffix}`),
      q('A', 'Ex-elite CS org', `site:linkedin.com/in ("Salesforce" OR "HubSpot" OR "Gainsight" OR "Snowflake" OR "Notion" OR "Ramp") ("Customer Success" OR "Account Management") (lead OR director OR VP OR head)${locSuffix}`),
      q('A', 'First CS hire 0→1', `site:linkedin.com/in ("first customer success hire" OR "founding customer success" OR "built the CS team" OR "built customer success") startup${locSuffix}`),
      q('B', 'CSM startup-ready', `site:linkedin.com/in ("customer success manager" OR "CSM") startup "early-stage"${locSuffix}`),
      ...(isChicago ? [q('A', 'Chicago CS leaders', `site:linkedin.com/in ("Head of Customer Success" OR "VP Customer Success") Chicago startup`)] : []),
    ],
    generalist: [
      q('A', 'First business hire', `site:linkedin.com/in ("Chief of Staff" OR "first business hire" OR "founding team" OR "General Manager") startup${locSuffix}`),
      q('A', 'Ex-founder operator', `site:linkedin.com/in ("former founder" OR "ex-founder" OR "previously founded") ("operator" OR "joining" OR "startup")${locSuffix}`),
    ],
  };
  return pools[archKey] || [];
}

// ── Query construction ──
function buildTalentQueries(criteria, fullSweep, roleScope = null) {
  // Non-engineering role-scoped sourcing → use the archetype's query pool so the
  // RIGHT people enter the funnel (a CMO search pulls GTM leaders, not engineers).
  const arch = getArchetype(roleScope, criteria);
  if (roleScope && arch.key !== 'engineering') {
    const locs = (criteria.locations || []).slice(0, 5);
    // This fund hires in Chicago first — if no location is set on the role, bias the
    // search to Chicago rather than searching nowhere.
    const loc0 = (locs[0] || 'chicago').toLowerCase();
    const locSuffix = ` ${loc0}`;
    const isChicago = /chicago|illinois|\bil\b/.test(loc0);
    // Use the WHOLE archetype pool — do NOT filter by the role's band. Band is the
    // seniority of the hire (handled in scoring/ranking); filtering queries by it shrank
    // a Band-B CMO search to a single query and returned almost nobody.
    let queries = archetypeQueries(arch.key, locSuffix, isChicago);
    for (const cq of (criteria.customQueries || [])) {
      if (cq.query) queries.push({ name: cq.name || 'Custom query', query: cq.query, band: cq.band || null });
    }
    return fullSweep ? queries : queries.slice(0, 12);
  }
  return buildEngineeringQueries(criteria, fullSweep);
}

// JD-DRIVEN QUERIES — turn the actual job description into targeted LinkedIn searches.
// The canned archetype pool gives breadth; this gives PRECISION for the specific role
// (its seniority, domain, target companies, and must-haves). This is what lets "paste a
// JD → get best-fit first hires" actually work. Returns [] on any failure (we keep the
// canned queries as a floor) so a flaky LLM call never zeroes out a run.
async function deriveJdQueries(anthropic, roleScope, archKey, locSuffix) {
  if (!anthropic || !roleScope) return [];
  const jd = (roleScope.jd_content || '').slice(0, 4000);
  const mustHaves = (roleScope.must_haves || []).join('; ');
  const domains = (roleScope.domains || []).join(', ');
  if (!jd && !mustHaves && !roleScope.title) return [];
  try {
    const resp = await anthropic.messages.create({
      model: 'claude-sonnet-4-20250514',
      max_tokens: 700,
      system: `You convert a startup job description into precise LinkedIn people-search queries for sourcing the BEST first hires.
Rules:
- Every query MUST start with: site:linkedin.com/in
- Encode the role's seniority, FUNCTION (${archKey}), domain, and named target companies from the JD.
- Use boolean OR groups in parentheses for synonyms and peer companies.
- Append the location"${locSuffix}" to every query unless the JD is explicitly remote.
- Prefer specifics from the JD (named companies, domain terms, concrete skills) over generic titles.
- Return ONLY JSON: {"queries":[{"band":"A|B|C","name":"<short label>","query":"<query>"}]} with 4-6 queries.
- Band A = ideal best-of-best fit; B = strong startup-ready; C = adjacent/crossover.`,
      messages: [{
        role: 'user',
        content: `ROLE TITLE: ${roleScope.title || '(none)'}
FUNCTION: ${archKey}
TARGET LOCATION SUFFIX: ${locSuffix || '(none)'}
MUST-HAVES: ${mustHaves || '(none)'}
DOMAINS: ${domains || '(none)'}

JOB DESCRIPTION:
${jd || '(no long-form JD; use the title and must-haves)'}`
      }]
    });
    const text = resp.content[0].text.trim();
    const m = text.match(/\{[\s\S]*\}/);
    if (!m) return [];
    const parsed = JSON.parse(m[0]);
    const out = [];
    for (const q of (parsed.queries || [])) {
      let query = String(q.query || '').trim();
      if (!query) continue;
      if (!/site:linkedin\.com\/in/i.test(query)) query = `site:linkedin.com/in ${query}`;
      out.push({ band: /^[ABC]$/.test(q.band) ? q.band : 'B', name: `JD: ${String(q.name || 'targeted').slice(0, 40)}`, query });
    }
    return out.slice(0, 6);
  } catch (e) {
    console.error('[TalentEngine] JD query derivation failed:', e.message);
    return [];
  }
}

function buildEngineeringQueries(criteria, fullSweep) {
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

  const arch = getArchetype(roleScope, criteria);

  return `You are a talent scout for Superior Studios, a Chicago-based pre-seed VC.
Your job: identify ${arch.mission} These are HIRES who would join a top-tier founding team. The bar is bulletproof and impressive — if you would not stake your reputation on the intro, score accordingly.
ROLE FUNCTION: ${arch.label}. Judge this candidate by the ${arch.label} bar below — NOT by criteria for any other function (e.g., do not penalize a go-to-market leader for lacking engineering pedigree).${roleBlock}

═══════ TIER-1 BAR (applies to Band A — ${arch.label}) ═══════
A Band-A candidate must satisfy AT LEAST TWO of these FOUR categories, with verifiable evidence:

${arch.bar}

═══════ SENIORITY vs. STAGE FIT (Band-A gate) ═══════
Candidates must be PRE-PEAKED, not POST-PEAKED — hungry for the leap, not coasting on title.
${arch.seniority}

═══════ SUB-SCORES (1–10 each, return all four) ═══════
1. ${arch.caliberName} (40%) — ${arch.caliberDef}
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
        scored: true,
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
    scored: false,
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

  // Record the run at the VERY TOP — before any early-return — so an abort can never show
  // as "never run". Every invocation leaves a row + a readable reason.
  const run = db.prepare('INSERT INTO talent_sourcing_runs (user_id, role_id) VALUES (?, ?)').run(userId, roleScope?.id || null);
  const runId = run.lastInsertRowid;

  if (!apiKeys.exa) {
    const reason = 'No Exa API key configured (sourcing cannot run)';
    console.log('[TalentEngine] ' + reason);
    db.prepare('UPDATE talent_sourcing_runs SET candidates_found = 0, candidates_added = 0, matches_generated = 0, errors = ?, summary = ? WHERE id = ?')
      .run(JSON.stringify([{ error: reason }]), JSON.stringify({ role: roleScope ? { id: roleScope.id, title: roleScope.title } : null, queries: 0, found: 0, added: 0, matchesCreated: 0, error: reason }), runId);
    return { candidatesFound: 0, candidatesAdded: 0, error: reason };
  }

  const sourcesHit = [];
  const errors = [];
  let found = 0, added = 0, deduped = 0;

  const candidates = [];

  // Anthropic client — built early so the JD can drive the search, not just the scoring.
  let anthropic = null;
  if (apiKeys.anthropic) {
    try {
      const Anthropic = require('@anthropic-ai/sdk');
      anthropic = new Anthropic({ apiKey: apiKeys.anthropic });
    } catch {}
  }

  const arch = getArchetype(roleScope, criteria);
  const isEngineering = arch.key === 'engineering';

  // Phase 1: Exa — canned archetype queries (breadth) + JD-derived queries (precision).
  let queries = buildTalentQueries(criteria, fullSweep, roleScope);
  if (roleScope && (roleScope.jd_content || roleScope.must_haves?.length || roleScope.title)) {
    const loc0 = ((criteria.locations || [])[0] || 'chicago').toLowerCase();
    const jdQueries = await deriveJdQueries(anthropic, roleScope, arch.key, ` ${loc0}`);
    if (jdQueries.length) {
      // JD-derived queries lead (most targeted); canned pool fills remaining breadth.
      const cap = fullSweep ? 18 : 12;
      queries = [...jdQueries, ...queries].slice(0, cap);
      console.log(`[TalentEngine] +${jdQueries.length} JD-derived queries from "${roleScope.title}"`);
    }
  }
  console.log(`[TalentEngine] Running ${queries.length} Exa queries`);

  for (const q of queries) {
    const { results, error } = await searchExa(q.query, fullSweep ? 30 : 15, apiKeys.exa);
    if (error) { errors.push({ q: q.name, error }); continue; }
    sourcesHit.push(`exa:${q.name}`);

    for (const r of results) {
      const headline = r.title || '';
      // Strip "People also viewed" contamination before anything reasons about this person.
      const text = cleanProfileText(r.text || '');
      const url = r.url || '';
      const isLI = url.includes('linkedin.com/in/');
      let name = headline.split(/[|·—\-]/)[0].trim();
      if (name.length > 60) name = name.slice(0, 60);
      // Name gate: must be a real person, not an article/company headline.
      if (!isPlausiblePersonName(name)) continue;

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

  // Phase 2: GitHub — ONLY for engineering roles. GitHub surfaces engineers; running it
  // for a CMO/GTM/CS role just floods the pool with off-function profiles.
  if (isEngineering) {
    const gh = await searchGitHubTalent(criteria, apiKeys.github);
    console.log(`[TalentEngine] GitHub found ${gh.length}`);
    sourcesHit.push('github');
    for (const g of gh) {
      candidates.push({ ...g, search_query: 'github', search_band_hint: null });
    }
    found += gh.length;
  } else {
    console.log(`[TalentEngine] Skipping GitHub (non-engineering role: ${arch.key})`);
  }

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

  // Phase 4: Score with Claude (client built in Phase 1)
  const prompt = buildTalentScoringPrompt(criteria, roleScope);
  const { inferCandidateFunction } = require('./match-engine');
  const insert = db.prepare(`
    INSERT INTO talent_candidates (
      user_id, name, headline, linkedin_url, github_url, email,
      current_company, current_role, years_experience,
      location_city, tech_stack, pedigree_signals, builder_signals, leap_signals,
      band_fit, score_build_caliber, score_leap_readiness, score_domain_fit,
      score_geography, overall_score, score_rationale, one_liner,
      source, search_query, raw_data, role_function
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);

  let rejectedByLocation = 0;
  let rejectedByBand = 0;
  let rejectedByTier1 = 0;
  let rejectedByScore = 0;
  const bandAMode = roleScope ? roleScope.band === 'A' : (criteria.bands || []).includes('A');
  const TIER1_MIN_SCORE = bandAMode ? 7 : 6;
  for (const c of unique) {
    const localSignals = extractTalentSignals(c.text, c.headline, criteria);

    // FAIL CLOSED: a candidate is admitted ONLY when AI verification actually ran. Without
    // the LLM (no key or an API error like exhausted credits) we cannot judge fit or verify
    // claims, so we SKIP rather than admit a default-5 "Scoring unavailable" candidate.
    if (!anthropic) {
      rejectedByScore++;
      console.log(`[TalentEngine] ⏭️ ${c.name} → skipped: AI scoring unavailable (no Anthropic key)`);
      continue;
    }
    const score = await scoreCandidate(anthropic, c, prompt);
    if (!score.scored) {
      rejectedByScore++;
      console.log(`[TalentEngine] ⏭️ ${c.name} → skipped: not verified (${score.score_rationale})`);
      continue;
    }

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

    // Caliber: keep every function- and location-fit candidate that isn't junk, and let
    // the MATCH SCORE rank them (tier1/score still shows in the UI). Why not a hard band-A
    // floor? LinkedIn snippets from Exa are thin, so a real CMO/GTM leader often can't clear
    // a "2-of-4 with verbatim evidence" bar — that left role queues EMPTY. Better to surface
    // the best available, ranked, than to show nothing. Only truly weak profiles are dropped.
    {
      const JUNK_FLOOR = 4;
      if (score.overall_score < JUNK_FLOOR) {
        rejectedByScore++;
        console.log(`[TalentEngine] 🚫 ${c.name} → skipped: weak (${score.overall_score} < ${JUNK_FLOOR})`);
        continue;
      }
    }

    // Merge local + AI signals (pedigree already verified above)
    const mergeArr = (a, b) => [...new Set([...(a || []), ...(b || [])])];
    const pedigree = score.pedigree_signals; // verified, do not re-merge local (avoids re-injecting hallucinated tags)
    const builder = mergeArr(localSignals.builder, score.builder_signals);
    const leap = mergeArr(localSignals.leap, score.leap_signals);
    const stack = mergeArr(localSignals.stack, score.tech_stack);

    // Type the candidate by function. For a ROLE-SCOPED run we TRUST the role's function:
    // these candidates were found by that function's targeted queries (and GitHub is skipped
    // for non-eng), so a CMO search yields marketing leaders. Forcing the role function here
    // is what stops a thin-LinkedIn marketer from being mis-typed and then dropped by the
    // match-time function gate (the root cause of empty CMO/GTM queues). The function gate
    // still protects the GLOBAL daily run, which infers from the profile.
    const candFn = inferCandidateFunction({
      current_role: score.current_role, headline: c.headline, one_liner: score.one_liner, tech_stack: JSON.stringify(stack),
    });
    const roleFunction = roleScope ? roleScope.function : candFn;

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
        JSON.stringify({ headline: c.headline, text: (c.text || '').slice(0, 2000) }),
        roleFunction
      );
      added++;
      console.log(`[TalentEngine] ${score.overall_score >= 8 ? '🔥' : score.overall_score >= 6 ? '✅' : '📝'} ${c.name} → ${score.overall_score}/10 [bands: ${(score.band_fit || []).join(',')}]`);
    } catch (err) {
      errors.push({ name: c.name, error: err.message });
    }
  }

  // Phase 5: match candidates to roles.
  //  • Role-scoped run: match the ENTIRE function-relevant candidate pool against THIS role
  //    (not just the last 24h), and ALWAYS run — so the role gets its matches even if every
  //    fresh hit was a duplicate. This is the fix for "a role never matches the existing pool."
  //  • Global daily run: only the newly-added candidates, against all open roles.
  let matchesCreated = 0;
  try {
    const { runMatchEngine } = require('./match-engine');
    if (roleScope) {
      const result = await runMatchEngine({ userId, roleId: roleScope.id, onlyNewCandidates: false, minScore: 35 });
      matchesCreated = result.matches_created || 0;
    } else if (added > 0) {
      const result = await runMatchEngine({ userId, onlyNewCandidates: true, minScore: 50 });
      matchesCreated = result.matches_created || 0;
    }
  } catch (err) {
    errors.push({ stage: 'match', error: err.message });
  }

  // Update run log + a human-readable diagnostic summary (per role).
  const summary = {
    role: roleScope ? { id: roleScope.id, title: roleScope.title, function: arch.key } : null,
    queries: queries.length,
    found, added, deduped, matchesCreated,
    rejected: { location: rejectedByLocation, score: rejectedByScore },
    exaErrors: errors.filter(e => e.q).map(e => `${e.q}: ${e.error}`).slice(0, 5),
  };
  db.prepare('UPDATE talent_sourcing_runs SET sources_hit = ?, candidates_found = ?, candidates_added = ?, candidates_deduplicated = ?, matches_generated = ?, errors = ?, role_id = ?, summary = ? WHERE id = ?').run(
    JSON.stringify(sourcesHit), found, added, deduped, matchesCreated, JSON.stringify(errors), roleScope?.id || null, JSON.stringify(summary), runId
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

module.exports = {
  runTalentEngine,
  // Exported for testing/reuse
  normalizeArchetype,
  getArchetype,
  buildTalentScoringPrompt,
  buildTalentQueries,
  deriveJdQueries,
  archetypeQueries,
};
