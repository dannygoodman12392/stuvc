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

function verifyIllinois(text, headline) {
  const combined = ((headline || '') + ' ' + (text || '')).toLowerCase();

  // Current location
  for (const loc of ILLINOIS_LOCATIONS) {
    if (combined.includes(`${loc}, illinois`) || combined.includes(`${loc}, il`)) {
      return { verified: true, type: 'current', location: loc.charAt(0).toUpperCase() + loc.slice(1) };
    }
  }
  if (combined.includes('greater chicago area') || combined.includes('chicagoland') || combined.includes('chicago metropolitan')) {
    return { verified: true, type: 'current', location: 'Chicago Area' };
  }

  // Work context
  const workPatterns = [
    /based in (chicago|illinois|evanston)/,
    /located in (chicago|illinois)/,
    /(building|working).{0,40}chicago/,
    /(moved|relocated|moving).{0,30}(to\s+)?chicago/,
    /chicago.{0,40}(engineer|founder|cto|vp|director|head of|ceo)/,
  ];
  for (const p of workPatterns) {
    if (p.test(combined)) return { verified: true, type: 'working', location: 'Chicago' };
  }

  // Illinois school alumni
  for (const school of ILLINOIS_SCHOOLS) {
    if (combined.includes(school)) {
      return { verified: true, type: 'school_alumni', location: school.split(' ').map(w => w.charAt(0).toUpperCase() + w.slice(1)).join(' ') };
    }
  }

  // Elite school + any Chicago mention (weaker but valid)
  const hasChicagoMention = combined.includes('chicago') || combined.includes('illinois');
  if (hasChicagoMention) {
    for (const school of ELITE_SCHOOLS) {
      if (combined.includes(school)) {
        return { verified: true, type: 'school_alumni', location: school.split(' ').map(w => w.charAt(0).toUpperCase() + w.slice(1)).join(' ') };
      }
    }
  }

  return { verified: false, type: null, location: null };
}

// ── Generic Location Verification (uses user's target locations) ──

function verifyLocation(text, headline, criteria) {
  const combined = ((headline || '') + ' ' + (text || '')).toLowerCase();
  const userLocations = (criteria.locations || []).map(l => l.toLowerCase());
  const userSchools = (criteria.schools || []).map(s => s.toLowerCase());

  // Check current location match against user's target locations
  for (const loc of userLocations) {
    // Direct location mention
    if (combined.includes(loc)) {
      return { verified: true, type: 'current', location: loc.charAt(0).toUpperCase() + loc.slice(1) };
    }
  }

  // Check school alumni match against user's target schools
  for (const school of userSchools) {
    if (combined.includes(school)) {
      return { verified: true, type: 'school_alumni', location: school.split(' ').map(w => w.charAt(0).toUpperCase() + w.slice(1)).join(' ') };
    }
  }

  // Also check against elite schools if there's any location mention
  const hasLocationMention = userLocations.some(loc => combined.includes(loc));
  if (hasLocationMention) {
    for (const school of ELITE_SCHOOLS) {
      if (combined.includes(school)) {
        return { verified: true, type: 'school_alumni', location: school.split(' ').map(w => w.charAt(0).toUpperCase() + w.slice(1)).join(' ') };
      }
    }
  }

  return { verified: false, type: null, location: null };
}

function extractSignals(text, headline) {
  const combined = ((headline || '') + ' ' + (text || '')).toLowerCase();
  const pedigree = [];
  const builder = [];

  // School pedigree
  for (const school of [...ILLINOIS_SCHOOLS, ...ELITE_SCHOOLS]) {
    if (combined.includes(school)) {
      pedigree.push(school.split(' ').map(w => w.charAt(0).toUpperCase() + w.slice(1)).join(' '));
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

  return { pedigree: [...new Set(pedigree)], builder: [...new Set(builder)] };
}

// ── Stage Pre-filter: Skip founders who are clearly too far along ──

function isTooFarAlong(text, headline) {
  const h = (headline || '').toLowerCase();

  // Only filter on HEADLINE signals — these are self-descriptions.
  // Profile text mentions of "Series A" are often about past employers, not own company.
  const tooLateHeadlinePatterns = [
    /\bipo\b/,
    /\bunicorn\b/,
    /\b\d{3,}\+?\s*employees\b/,                  // "500+ employees" in headline
  ];

  for (const p of tooLateHeadlinePatterns) {
    if (p.test(h)) return true;
  }
  return false;
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

const SEARCH_GROUPS = {
  monday: [
    { name: 'Stealth founder Chicago', query: 'stealth mode founder Chicago Illinois building something new just left 2025 2026' },
    { name: 'SF to Chicago stealth', query: 'founder moved San Francisco to Chicago stealth building new company pre-seed' },
    { name: 'NYC to Chicago stealth', query: 'founder moved New York to Chicago stealth startup building new pre-launch' },
    { name: 'Bay Area to Illinois stealth', query: 'Bay Area Silicon Valley moved Chicago Illinois engineer stealth building new startup' },
    { name: 'Returned to Chicago new co', query: 'returned moved back Chicago Illinois building new startup stealth after Google Meta Stripe 2025' },
    { name: 'Just quit to build Chicago', query: 'just quit left job to start build company Chicago Illinois founder stealth 2025 2026' },
    { name: 'YC alum starting new Chicago', query: 'Y Combinator YC alumni starting new company Chicago Illinois stealth exploring' },
    { name: 'Techstars alum new venture Chicago', query: 'Techstars alumni starting new venture Chicago Illinois stealth pre-seed' },
  ],
  tuesday: [
    { name: 'Ex-OpenAI stealth Chicago', query: 'left OpenAI stealth building new startup Chicago Illinois AI pre-seed 2025' },
    { name: 'Ex-Google stealth Chicago', query: 'left Google engineer stealth new startup Chicago Illinois founding pre-launch 2025' },
    { name: 'Ex-Stripe stealth Chicago', query: 'left Stripe stealth new company fintech payments Chicago Illinois pre-seed' },
    { name: 'Ex-Meta stealth Chicago', query: 'Meta Facebook engineer left stealth new startup Chicago Illinois pre-seed 2025' },
    { name: 'Ex-Anthropic stealth', query: 'ex Anthropic AI left stealth new startup Chicago Illinois pre-seed' },
    { name: 'Ex-SpaceX defense stealth', query: 'SpaceX Anduril Palantir engineer left stealth Chicago Illinois founder new company' },
    { name: 'Ex-hyperscale stealth Chicago', query: 'left Apple Amazon Microsoft engineer stealth Chicago Illinois founder new startup pre-seed' },
    { name: 'Eng leader starting company', query: 'head of engineering VP engineering left starting new company stealth Chicago Illinois pre-seed 2025' },
  ],
  wednesday: [
    { name: 'AI stealth Chicago 2025', query: 'AI stealth founder Chicago Illinois 2025 2026 building new machine learning pre-seed' },
    { name: 'LLM AI agent stealth Chicago', query: 'LLM AI agent stealth builder founder Chicago Illinois new startup pre-launch' },
    { name: 'AI infra early stage Chicago', query: 'AI infrastructure ML ops stealth pre-seed Chicago Illinois founder building' },
    { name: 'ML PhD starting co Chicago', query: 'machine learning PhD starting company stealth Chicago Illinois pre-seed commercialize' },
    { name: 'Defense tech stealth Chicago', query: 'defense technology stealth founder Chicago Illinois new company pre-seed' },
    { name: 'Argonne Fermilab spinout', query: 'Argonne National Laboratory Fermilab researcher starting company spinout Illinois Chicago new' },
    { name: 'UIUC research spinout', query: 'UIUC research professor PhD startup founder commercialize new company Illinois stealth' },
    { name: 'Climate stealth Chicago', query: 'climate technology clean energy stealth founder Chicago Illinois new startup pre-seed' },
  ],
  thursday: [
    { name: 'Fintech stealth Chicago', query: 'fintech stealth founder Chicago Illinois payments banking new startup pre-seed 2025' },
    { name: 'Ex-Citadel starting co', query: 'Citadel Jump Trading DRW left starting new company stealth Chicago pre-seed' },
    { name: 'Health tech stealth Chicago', query: 'health technology digital health stealth founder Chicago Illinois new startup pre-seed' },
    { name: 'Biotech early stage Chicago', query: 'biotech pharmaceutical new company stealth founder Chicago Illinois pre-seed early' },
    { name: 'Vertical SaaS stealth Chicago', query: 'vertical SaaS stealth founder Chicago Illinois new company pre-seed construction logistics' },
    { name: 'Proptech stealth Chicago', query: 'proptech real estate technology stealth founder Chicago Illinois new startup pre-seed' },
    { name: 'Cybersecurity stealth Chicago', query: 'cybersecurity stealth founder Chicago Illinois new startup pre-seed early stage' },
    { name: 'Insurance stealth Chicago', query: 'insurtech insurance technology stealth Chicago Illinois founder new startup pre-seed' },
  ],
  friday: [
    { name: 'Serial founder new co Chicago', query: 'serial founder exited previous company building new startup Chicago Illinois stealth pre-seed 2025' },
    { name: 'Post-exit building new Chicago', query: 'sold company acquired exited building new startup stealth Chicago Illinois pre-seed 2025' },
    { name: 'Post-acquisition new co Chicago', query: 'post acquisition founder building new company stealth Chicago Illinois pre-seed' },
    { name: 'Early employee going solo', query: 'early employee first engineer startup Chicago Illinois exploring starting own company founding stealth' },
    { name: 'Staff eng side project Chicago', query: 'staff engineer principal engineer side project exploring starting Chicago Illinois stealth pre-seed' },
    { name: 'SPC On Deck exploring Chicago', query: 'South Park Commons On Deck member Chicago Illinois exploring stealth building pre-seed' },
    { name: 'Devtools stealth Chicago', query: 'developer tools devtools stealth founder Chicago Illinois new startup pre-seed open source' },
    { name: 'OSS creator starting co Chicago', query: 'open source creator maintainer starting company stealth Chicago Illinois pre-seed' },
  ],
};

// These run EVERY day alongside the daily rotation — they target LinkedIn stealth profiles
const DAILY_STEALTH_QUERIES = [
  { name: 'LinkedIn stealth Chicago', query: 'site:linkedin.com/in "stealth" "Chicago" founder building' },
  { name: 'LinkedIn building something new Chicago', query: 'site:linkedin.com/in "building something new" Chicago Illinois founder engineer' },
  { name: 'LinkedIn stealth mode Illinois', query: 'site:linkedin.com/in "stealth mode" Illinois founder co-founder CEO' },
  { name: 'LinkedIn exploring next Chicago', query: 'site:linkedin.com/in "exploring" "what\'s next" Chicago Illinois engineer founder' },
  { name: 'LinkedIn stealth startup Chicago', query: 'site:linkedin.com/in "stealth startup" Chicago Illinois co-founder' },
  { name: 'LinkedIn building Chicago founder', query: 'site:linkedin.com/in "building" founder CEO co-founder Chicago 2025' },
  { name: 'LinkedIn ex-Google Chicago stealth', query: 'site:linkedin.com/in "ex-Google" OR "formerly Google" Chicago stealth founder' },
  { name: 'LinkedIn Northwestern founder stealth', query: 'site:linkedin.com/in Northwestern founder stealth building Chicago' },
  { name: 'LinkedIn UChicago founder building', query: 'site:linkedin.com/in "University of Chicago" founder building startup stealth' },
  { name: 'LinkedIn UIUC founder stealth', query: 'site:linkedin.com/in "University of Illinois" founder stealth building startup Chicago' },
  { name: 'LinkedIn new venture Chicago', query: 'site:linkedin.com/in "new venture" OR "next chapter" Chicago Illinois founder' },
  { name: 'LinkedIn pre-seed Chicago', query: 'site:linkedin.com/in "pre-seed" Chicago Illinois founder building' },
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

const SCORING_PROMPT = `You are the deal sourcing analyst for Superior Studios, a Chicago-based PRE-SEED venture fund (~$10M Fund I) led by Danny Goodman and Eric Hutt.

Score this founder candidate 1-10 on fit with Superior Studios. The fund ONLY invests at pre-seed. We are looking for:
1. People in STEALTH MODE — just left a job, building something new, haven't raised yet
2. Potential founders — exceptional builders at top companies who look like they're about to start something
3. Very early-stage founders — pre-seed, maybe angel round, no institutional funding yet

CRITICAL DISQUALIFIERS (auto-score 1-3):
- Company has ALREADY RAISED Series A or later → score 1-2 (too late for us)
- Company has raised a large seed ($5M+) → score 2-3 (likely too late)
- Company is established/mature (founded 3+ years ago with meaningful revenue/team) → score 1-3
- Person is a senior exec at an established company with no sign of leaving → score 2-3
- The person is clearly a job-seeker, not a founder/builder → score 1-2

GEOGRAPHY (25% weight):
- 9-10: Currently building in Chicago. Born/raised in Chicago area. Deep Chicago roots + building here.
- 7-8: Illinois-based. Went to Northwestern, UChicago, UIUC, or other Illinois school. Lived/worked in Chicago previously.
- 5-6: Midwest-based or has meaningful Illinois ties (family, previous job, school). Stanford/Harvard/MIT grad with Chicago connection.
- 3-4: National with no direct Chicago/IL connection but genuinely exceptional caliber.
- 1-2: No geographic fit and not exceptional enough to overcome.

FOUNDER CALIBER (35% weight):
- 9-10: Previously exited a company. Serial founder. Product/eng leadership at Google, Meta, Stripe, OpenAI, Anthropic, Palantir, SpaceX, or similar. YC/TechStars/SPC alum. PhD from elite institution doing commercialization.
- 7-8: Staff+ engineer at notable tech company. Elite institution. First-time founder with exceptional domain expertise or technical depth.
- 5-6: Solid professional background. Good institution. Relevant industry experience.
- 3-4: Junior or unclear background. Limited evidence of building ability.
- 1-2: No evidence of relevant experience or building.

STAGE & TIMING (25% weight — this is critical):
- 9-10: STEALTH MODE. Just left a top company to build something new. Pre-product, pre-revenue. No funding yet or just angels/friends & family. This is our sweet spot.
- 7-8: Very early. Has a prototype or MVP. Pre-seed or small angel round. Founded in last 12 months.
- 5-6: Exploring, thinking about starting something. Still at their job but clearly restless/building on the side.
- 3-4: Has raised a seed round ($2-4M). Getting late for us but might still be reachable.
- 1-2: Series A or later. Established company. Clearly too far along for pre-seed investment.

SECTOR FIT (15% weight):
- B2B SaaS, AI/ML, developer tools, fintech, healthtech, defense/govtech, vertical software, marketplace — ideal
- Deep tech, climate tech, biotech — good if founder is exceptional
- Consumer, social, crypto — lower fit unless exceptional

IMPORTANT: If you see any evidence the company has raised a Series A, Series B, or significant venture funding, the score MUST be 3 or below regardless of how impressive the founder is. We literally cannot invest at that stage.

Return ONLY valid JSON:
{
  "confidence_score": <1-10 integer>,
  "confidence_rationale": "<2-3 sentences explaining fit. Be specific about stage/timing, geographic connection, and caliber signals. If too far along, say so explicitly.>",
  "tags": ["<domain>", "<stage>", "<geography>", "<signal>"],
  "chicago_connection": "<one sentence: their specific Chicago/Illinois tie>",
  "pedigree_signals": ["<school or company pedigree, e.g. 'Ex-Google Staff Eng', 'Northwestern Kellogg MBA'>"],
  "builder_signals": ["<evidence of building, e.g. 'Previous exit (acquired by X)', 'Active GitHub (500+ stars)', 'YC W24'>"],
  "company_one_liner": "<what they're building, or 'Stealth' or 'Exploring' if unclear>"
}`;

async function scoreFounder(client, founder, scoringPrompt) {
  try {
    const response = await client.messages.create({
      model: 'claude-sonnet-4-20250514',
      max_tokens: 768,
      system: scoringPrompt || SCORING_PROMPT,
      messages: [{
        role: 'user',
        content: `Score this founder candidate:\n\nName: ${founder.name}\nHeadline: ${founder.headline || 'N/A'}\nCompany: ${founder.company || 'Unknown'}\nLinkedIn: ${founder.linkedin_url || 'N/A'}\nGitHub: ${founder.github_url || 'N/A'}\nSource: ${founder.source}\n\nProfile text:\n${(founder.text || '').slice(0, 4000)}`
      }]
    });

    const text = response.content[0].text.trim();
    const jsonMatch = text.match(/\{[\s\S]*\}/);
    if (jsonMatch) {
      const parsed = JSON.parse(jsonMatch[0]);
      return {
        confidence_score: parsed.confidence_score || 5,
        confidence_rationale: parsed.confidence_rationale || '',
        tags: parsed.tags || [],
        chicago_connection: parsed.chicago_connection || '',
        pedigree_signals: parsed.pedigree_signals || [],
        builder_signals: parsed.builder_signals || [],
        company_one_liner: parsed.company_one_liner || '',
      };
    }
    return { confidence_score: 5, confidence_rationale: 'Could not parse scoring response', tags: [], chicago_connection: '', pedigree_signals: [], builder_signals: [], company_one_liner: '' };
  } catch (err) {
    return { confidence_score: 5, confidence_rationale: 'Scoring failed: ' + err.message, tags: [], chicago_connection: '', pedigree_signals: [], builder_signals: [], company_one_liner: '' };
  }
}

// ── Deduplication ──

function isDuplicate(founder, userId) {
  // Check by LinkedIn URL (scoped to user)
  if (founder.linkedin_url) {
    const normalizedUrl = founder.linkedin_url.replace(/\/$/, '').toLowerCase();
    const slug = normalizedUrl.split('/in/')[1] || normalizedUrl;
    const existing = db.prepare('SELECT id FROM founders WHERE LOWER(linkedin_url) LIKE ? AND created_by = ? AND is_deleted = 0').get(`%${slug}%`, userId);
    if (existing) return true;
    const sourced = db.prepare("SELECT id FROM sourced_founders WHERE LOWER(linkedin_url) LIKE ? AND user_id = ? AND status != 'dismissed'").get(`%${slug}%`, userId);
    if (sourced) return true;
  }
  // Check by email (scoped to user)
  if (founder.email) {
    const existing = db.prepare('SELECT id FROM founders WHERE email = ? AND created_by = ? AND is_deleted = 0').get(founder.email, userId);
    if (existing) return true;
    const sourced = db.prepare("SELECT id FROM sourced_founders WHERE email = ? AND user_id = ? AND status != 'dismissed'").get(founder.email, userId);
    if (sourced) return true;
  }
  // Check by name + company (scoped to user)
  if (founder.name && founder.company) {
    const existing = db.prepare('SELECT id FROM founders WHERE LOWER(name) = LOWER(?) AND LOWER(company) = LOWER(?) AND created_by = ? AND is_deleted = 0').get(founder.name, founder.company, userId);
    if (existing) return true;
    const sourced = db.prepare("SELECT id FROM sourced_founders WHERE LOWER(name) = LOWER(?) AND LOWER(company) = LOWER(?) AND user_id = ? AND status != 'dismissed'").get(founder.name, founder.company, userId);
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
  const settingsRoute = require('../routes/settings');
  // Read directly from DB, falling back to defaults
  const DEFAULT_SETTINGS = {
    sourcing_locations: JSON.stringify(['chicago', 'evanston', 'naperville', 'aurora', 'joliet', 'rockford', 'schaumburg', 'palatine', 'skokie', 'oak park', 'urbana', 'champaign']),
    sourcing_schools: JSON.stringify(['university of illinois', 'northwestern university', 'university of chicago', 'illinois institute of technology', 'loyola chicago', 'depaul university']),
    sourcing_companies: JSON.stringify(['google', 'meta', 'apple', 'amazon', 'microsoft', 'stripe', 'openai', 'anthropic', 'palantir', 'spacex', 'coinbase', 'datadog', 'snowflake']),
    sourcing_builder_signals: JSON.stringify(['YC Alum', 'Techstars', 'Previous Exit', 'Serial Founder', 'PhD', 'Open Source', 'Patent Holder', 'Stealth Mode']),
    sourcing_domains: JSON.stringify(['AI/ML', 'Fintech', 'Health Tech', 'Defense Tech', 'Climate Tech', 'Developer Tools', 'Vertical SaaS', 'Cybersecurity', 'Biotech']),
    sourcing_stage_filter: 'Pre-seed',
    sourcing_custom_queries: JSON.stringify([]),
  };

  const keys = Object.keys(DEFAULT_SETTINGS);
  const rows = db.prepare(
    `SELECT setting_key, setting_value FROM user_settings WHERE user_id = ? AND setting_key IN (${keys.map(() => '?').join(',')})`
  ).all(userId, ...keys);

  const userMap = {};
  for (const row of rows) userMap[row.setting_key] = row.setting_value;

  function parse(val) { try { return JSON.parse(val); } catch { return val; } }

  return {
    locations: parse(userMap.sourcing_locations || DEFAULT_SETTINGS.sourcing_locations),
    schools: parse(userMap.sourcing_schools || DEFAULT_SETTINGS.sourcing_schools),
    companies: parse(userMap.sourcing_companies || DEFAULT_SETTINGS.sourcing_companies),
    builderSignals: parse(userMap.sourcing_builder_signals || DEFAULT_SETTINGS.sourcing_builder_signals),
    domains: parse(userMap.sourcing_domains || DEFAULT_SETTINGS.sourcing_domains),
    stageFilter: parse(userMap.sourcing_stage_filter || DEFAULT_SETTINGS.sourcing_stage_filter),
    customQueries: parse(userMap.sourcing_custom_queries || DEFAULT_SETTINGS.sourcing_custom_queries),
  };
}

function buildUserSearchQueries(criteria, fullSweep) {
  const locs = criteria.locations.slice(0, 5); // Top 5 locations
  const primaryLoc = locs[0] || 'Chicago';
  const companies = criteria.companies.slice(0, 8);
  const schools = criteria.schools.slice(0, 5);
  const domains = criteria.domains.slice(0, 6);
  const stage = criteria.stageFilter || 'Pre-seed';

  const queries = [];

  // Stealth founder queries per location
  for (const loc of locs.slice(0, 3)) {
    queries.push({ name: `Stealth founder ${loc}`, query: `stealth mode founder ${loc} building something new just left 2025 2026` });
    queries.push({ name: `LinkedIn stealth ${loc}`, query: `site:linkedin.com/in "stealth" "${loc}" founder building` });
    queries.push({ name: `Building new ${loc}`, query: `site:linkedin.com/in "building something new" ${loc} founder engineer` });
  }

  // Ex-company queries
  for (const co of companies.slice(0, 5)) {
    queries.push({ name: `Ex-${co} stealth ${primaryLoc}`, query: `left ${co} stealth new startup ${primaryLoc} founder ${stage} 2025` });
  }

  // School alumni queries
  for (const school of schools.slice(0, 3)) {
    queries.push({ name: `${school} founder stealth`, query: `site:linkedin.com/in "${school}" founder stealth building startup ${primaryLoc}` });
  }

  // Domain queries
  for (const domain of domains.slice(0, 4)) {
    queries.push({ name: `${domain} stealth ${primaryLoc}`, query: `${domain} stealth founder ${primaryLoc} new startup ${stage} 2025` });
  }

  // Generic high-signal queries
  queries.push({ name: `Serial founder ${primaryLoc}`, query: `serial founder exited previous company building new startup ${primaryLoc} stealth ${stage} 2025` });
  queries.push({ name: `${stage} ${primaryLoc}`, query: `site:linkedin.com/in "${stage}" ${primaryLoc} founder building` });
  queries.push({ name: `YC alum new ${primaryLoc}`, query: `Y Combinator YC alumni starting new company ${primaryLoc} stealth exploring` });
  queries.push({ name: `Just quit to build ${primaryLoc}`, query: `just quit left job to start build company ${primaryLoc} founder stealth 2025 2026` });

  // Custom queries from user
  for (const cq of (criteria.customQueries || [])) {
    if (cq.query) queries.push({ name: cq.name || 'Custom query', query: cq.query });
  }

  if (!fullSweep) return queries.slice(0, 20); // Cap daily at 20
  return queries;
}

function buildUserScoringPrompt(criteria) {
  const locations = criteria.locations.join(', ') || 'your target geographies';
  const schools = criteria.schools.join(', ') || 'target institutions';
  const companies = criteria.companies.join(', ') || 'top tech companies';
  const domains = criteria.domains.join(', ') || 'technology sectors';
  const stage = criteria.stageFilter || 'Pre-seed';

  return `You are a deal sourcing analyst for a venture fund focused on ${stage} stage investing.

Score this founder candidate 1-10 on fit. The fund invests at ${stage} stage. We are looking for:
1. People in STEALTH MODE — just left a job, building something new, haven't raised yet
2. Potential founders — exceptional builders at top companies who look like they're about to start something
3. Very early-stage founders — pre-seed, maybe angel round, no institutional funding yet

CRITICAL DISQUALIFIERS (auto-score 1-3):
- Company has ALREADY RAISED Series A or later → score 1-2 (too late)
- Company has raised a large seed ($5M+) → score 2-3 (likely too late)
- Company is established/mature (founded 3+ years ago with meaningful revenue/team) → score 1-3
- Person is a senior exec at an established company with no sign of leaving → score 2-3
- The person is clearly a job-seeker, not a founder/builder → score 1-2

GEOGRAPHY (25% weight):
Target locations: ${locations}
- 9-10: Currently building in a target location. Deep local roots.
- 7-8: Based in or near target locations. Attended local institutions (${schools}). Previously lived/worked there.
- 5-6: Nearby region or meaningful ties. Elite institution grad with local connection.
- 3-4: National with no direct geographic connection but genuinely exceptional caliber.
- 1-2: No geographic fit and not exceptional enough to overcome.

FOUNDER CALIBER (35% weight):
Target companies: ${companies}
- 9-10: Previously exited a company. Serial founder. Product/eng leadership at target companies or equivalent. YC/TechStars alum. PhD commercializing.
- 7-8: Staff+ engineer at notable tech company. Elite institution. First-time founder with exceptional domain expertise.
- 5-6: Solid professional background. Good institution. Relevant industry experience.
- 3-4: Junior or unclear background. Limited evidence of building ability.
- 1-2: No evidence of relevant experience or building.

STAGE & TIMING (25% weight):
- 9-10: STEALTH MODE. Just left a top company to build something new. Pre-product, pre-revenue. No funding yet.
- 7-8: Very early. Has a prototype or MVP. Pre-seed or small angel round. Founded in last 12 months.
- 5-6: Exploring, thinking about starting something. Still employed but clearly building on the side.
- 3-4: Has raised a seed round ($2-4M). Getting late.
- 1-2: Series A or later. Established company.

SECTOR FIT (15% weight):
Target sectors: ${domains}

Return ONLY valid JSON:
{
  "confidence_score": <1-10 integer>,
  "confidence_rationale": "<2-3 sentences explaining fit>",
  "tags": ["<domain>", "<stage>", "<geography>", "<signal>"],
  "chicago_connection": "<one sentence: their specific geographic tie to your target locations>",
  "pedigree_signals": ["<school or company pedigree>"],
  "builder_signals": ["<evidence of building>"],
  "company_one_liner": "<what they're building, or 'Stealth' or 'Exploring' if unclear>"
}`;
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
      user_id
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);

  for (const candidate of uniqueCandidates) {
    // Pre-filter: skip founders who are obviously too far along (saves Claude API calls)
    if (isTooFarAlong(candidate.text, candidate.headline)) {
      console.log(`[Sourcing] ⏭️ ${candidate.name} — skipped (too far along, post-seed signals detected)`);
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
        userId
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

module.exports = { runSourcingEngine };
