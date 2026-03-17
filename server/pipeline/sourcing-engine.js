const db = require('../db');

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

const SCORING_PROMPT = `You are a deal sourcing analyst for Superior Studios, a Chicago-based pre-seed venture fund (~$10M Fund I).

Score this founder candidate 1-10 on fit with Superior Studios. The fund invests in the very best founders in and around Chicago. Here is the scoring rubric:

GEOGRAPHY (heavily weighted):
- 9-10: Currently building in Chicago. Born/raised in Chicago area. Deep Chicago roots.
- 7-8: Illinois-based. Went to UChicago, Northwestern, UIllinois, or other Illinois school. Lived in Chicago previously.
- 5-6: Midwest-based (Indiana, Wisconsin, Michigan, Ohio). Has some Illinois ties.
- 3-4: National with no Chicago/IL connection but exceptional caliber.
- 1-2: No geographic fit and not exceptional enough to overcome.

FOUNDER CALIBER (heavily weighted):
- 9-10: Previously exited a company. Serial founder building again. Product/engineering leadership at FAANG or hyperscaler. YC/TechStars alum. South Park Commons. PhD from elite institution.
- 7-8: Strong technical background. Engineering lead at notable tech company. Elite institution (Stanford, MIT, Harvard, Northwestern, UChicago, UIllinois). First-time founder with exceptional domain expertise.
- 5-6: Solid professional background. Good institution. Relevant industry experience.
- 3-4: Junior or unclear background. Weak evidence of building ability.
- 1-2: No evidence of relevant experience or building.

STAGE & SECTOR FIT:
- Pre-seed or about to start building (ideal)
- Seed stage (good)
- B2B SaaS, AI/ML infrastructure, vertical software, fintech, healthtech, marketplace (ideal sectors)
- Deep technical or domain-expert founder preferred

SIGNALS OF EXCELLENCE:
- Previous successful exit or acquisition
- VCs transitioning to founder role
- Multiple search appearances (multiple signals of activity)
- Stealth mode with strong background
- "Must look at" caliber — would any top VC want this person?

Return JSON only:
{
  "confidence_score": <1-10>,
  "confidence_rationale": "<2-3 sentences explaining fit. Be specific about geographic connection and caliber signals.>",
  "tags": ["domain tags", "stage tags", "geography tags"]
}`;

// ── Source Adapters ──

async function sourceFromProxycurl() {
  const apiKey = process.env.PROXYCURL_API_KEY;
  if (!apiKey) return { source: 'proxycurl', founders: [], error: 'No API key configured' };

  // Proxycurl person search for Chicago-area founders
  try {
    const fetch = require('node-fetch');
    const params = new URLSearchParams({
      country: 'US',
      city: 'Chicago',
      current_role_title: 'Founder OR CEO OR Co-founder',
      page_size: '10'
    });

    const resp = await fetch(`https://nubela.co/proxycurl/api/search/person/?${params}`, {
      headers: { 'Authorization': `Bearer ${apiKey}` }
    });

    if (!resp.ok) return { source: 'proxycurl', founders: [], error: `HTTP ${resp.status}` };
    const data = await resp.json();

    const founders = (data.results || []).map(r => ({
      name: r.name || `${r.first_name || ''} ${r.last_name || ''}`.trim(),
      company: r.company || null,
      role: r.title || 'Founder',
      linkedin_url: r.linkedin_profile_url || null,
      email: r.email || null,
      source: 'proxycurl',
      raw_data: JSON.stringify(r)
    }));

    return { source: 'proxycurl', founders };
  } catch (err) {
    return { source: 'proxycurl', founders: [], error: err.message };
  }
}

async function sourceFromHarmonic() {
  const apiKey = process.env.HARMONIC_API_KEY;
  if (!apiKey) return { source: 'harmonic', founders: [], error: 'No API key configured' };

  try {
    const fetch = require('node-fetch');
    const resp = await fetch('https://api.harmonic.ai/companies/search', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${apiKey}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        filters: {
          location: { states: ['Illinois', 'Indiana', 'Wisconsin', 'Michigan', 'Ohio'] },
          stage: ['Pre-seed', 'Seed'],
          founded_after: new Date(Date.now() - 365 * 24 * 60 * 60 * 1000).toISOString().split('T')[0]
        },
        limit: 20
      })
    });

    if (!resp.ok) return { source: 'harmonic', founders: [], error: `HTTP ${resp.status}` };
    const data = await resp.json();

    const founders = (data.results || data.companies || []).map(c => ({
      name: c.founder_name || c.ceo_name || 'Unknown',
      company: c.name || null,
      role: 'Founder',
      linkedin_url: c.founder_linkedin || c.linkedin_url || null,
      email: c.founder_email || null,
      source: 'harmonic',
      raw_data: JSON.stringify(c)
    }));

    return { source: 'harmonic', founders };
  } catch (err) {
    return { source: 'harmonic', founders: [], error: err.message };
  }
}

async function sourceFromCrunchbase() {
  const apiKey = process.env.CRUNCHBASE_API_KEY;
  if (!apiKey) return { source: 'crunchbase', founders: [], error: 'No API key configured' };

  try {
    const fetch = require('node-fetch');
    const resp = await fetch(`https://api.crunchbase.com/api/v4/searches/organizations`, {
      method: 'POST',
      headers: {
        'X-cb-user-key': apiKey,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        field_ids: ['identifier', 'short_description', 'location_identifiers', 'founded_on', 'founder_identifiers'],
        query: [{
          type: 'predicate',
          field_id: 'location_identifiers',
          operator_id: 'includes',
          values: ['Chicago, Illinois, United States']
        }, {
          type: 'predicate',
          field_id: 'last_funding_type',
          operator_id: 'includes',
          values: ['pre_seed', 'seed']
        }],
        order: [{ field_id: 'founded_on', sort: 'desc' }],
        limit: 20
      })
    });

    if (!resp.ok) return { source: 'crunchbase', founders: [], error: `HTTP ${resp.status}` };
    const data = await resp.json();

    const founders = (data.entities || []).map(e => ({
      name: (e.properties?.founder_identifiers || [])[0]?.value || 'Unknown',
      company: e.properties?.identifier?.value || null,
      role: 'Founder',
      linkedin_url: null,
      email: null,
      source: 'crunchbase',
      raw_data: JSON.stringify(e)
    }));

    return { source: 'crunchbase', founders };
  } catch (err) {
    return { source: 'crunchbase', founders: [], error: err.message };
  }
}

async function sourceFromGitHub() {
  const token = process.env.GITHUB_TOKEN;
  if (!token) return { source: 'github', founders: [], error: 'No token configured' };

  try {
    const fetch = require('node-fetch');
    // Search for Chicago-based users who recently created repos
    const resp = await fetch('https://api.github.com/search/users?q=location:Chicago+type:user+repos:>5&sort=joined&order=desc&per_page=20', {
      headers: { 'Authorization': `token ${token}`, 'Accept': 'application/vnd.github.v3+json' }
    });

    if (!resp.ok) return { source: 'github', founders: [], error: `HTTP ${resp.status}` };
    const data = await resp.json();

    const founders = (data.items || []).map(u => ({
      name: u.login,
      company: u.company || null,
      role: 'Technical Founder',
      linkedin_url: null,
      email: u.email || null,
      github_url: u.html_url,
      source: 'github',
      raw_data: JSON.stringify(u)
    }));

    return { source: 'github', founders };
  } catch (err) {
    return { source: 'github', founders: [], error: err.message };
  }
}

// ── Deduplication ──
function isDuplicate(founder) {
  if (founder.email) {
    const existing = db.prepare('SELECT id FROM founders WHERE email = ? AND is_deleted = 0').get(founder.email);
    if (existing) return true;
    const sourced = db.prepare("SELECT id FROM sourced_founders WHERE email = ? AND status != 'dismissed'").get(founder.email);
    if (sourced) return true;
  }
  if (founder.linkedin_url) {
    const existing = db.prepare('SELECT id FROM founders WHERE linkedin_url = ? AND is_deleted = 0').get(founder.linkedin_url);
    if (existing) return true;
    const sourced = db.prepare("SELECT id FROM sourced_founders WHERE linkedin_url = ? AND status != 'dismissed'").get(founder.linkedin_url);
    if (sourced) return true;
  }
  // Name + company match
  if (founder.name && founder.company) {
    const existing = db.prepare('SELECT id FROM founders WHERE name = ? AND company = ? AND is_deleted = 0').get(founder.name, founder.company);
    if (existing) return true;
    const sourced = db.prepare("SELECT id FROM sourced_founders WHERE name = ? AND company = ? AND status != 'dismissed'").get(founder.name, founder.company);
    if (sourced) return true;
  }
  return false;
}

// ── Claude Scoring ──
async function scoreFounder(client, founder) {
  try {
    const response = await client.messages.create({
      model: 'claude-sonnet-4-20250514',
      max_tokens: 512,
      system: SCORING_PROMPT,
      messages: [{
        role: 'user',
        content: `Score this founder candidate:
Name: ${founder.name}
Company: ${founder.company || 'Unknown'}
Role: ${founder.role || 'Founder'}
Source: ${founder.source}
Additional data: ${founder.raw_data || 'None'}`
      }]
    });

    const text = response.content[0].text.trim();
    const jsonMatch = text.match(/\{[\s\S]*\}/);
    if (jsonMatch) return JSON.parse(jsonMatch[0]);
    return { confidence_score: 5, confidence_rationale: 'Could not parse scoring response', tags: [] };
  } catch (err) {
    return { confidence_score: 5, confidence_rationale: 'Scoring failed: ' + err.message, tags: [] };
  }
}

// ── Slack Notification ──
async function notifySlack(message) {
  const webhookUrl = process.env.SLACK_WEBHOOK_URL;
  if (!webhookUrl) return;

  try {
    const fetch = require('node-fetch');
    await fetch(webhookUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ text: message })
    });
  } catch (err) {
    console.error('Slack notification failed:', err.message);
  }
}

// ── Main Engine ──
async function runSourcingEngine() {
  console.log('[Sourcing] Starting sourcing run...');

  const run = db.prepare('INSERT INTO sourcing_runs (sources_hit) VALUES (?)').run(JSON.stringify([]));
  const runId = run.lastInsertRowid;

  const sourcesHit = [];
  const errors = [];
  let totalFound = 0;
  let totalAdded = 0;
  let totalDeduped = 0;

  // Run all source adapters in parallel
  const results = await Promise.allSettled([
    sourceFromProxycurl(),
    sourceFromHarmonic(),
    sourceFromCrunchbase(),
    sourceFromGitHub()
  ]);

  const allFounders = [];
  for (const result of results) {
    if (result.status === 'fulfilled') {
      const { source, founders, error } = result.value;
      sourcesHit.push(source);
      if (error) errors.push({ source, error });
      allFounders.push(...founders);
      totalFound += founders.length;
    } else {
      errors.push({ source: 'unknown', error: result.reason?.message });
    }
  }

  // Deduplicate and score
  const anthropic = getAnthropicClient();
  const insertStmt = db.prepare('INSERT INTO sourced_founders (name, company, role, linkedin_url, email, source, confidence_score, confidence_rationale, raw_data) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)');

  for (const founder of allFounders) {
    if (!founder.name || founder.name === 'Unknown') continue;

    if (isDuplicate(founder)) {
      totalDeduped++;
      continue;
    }

    let score = { confidence_score: 5, confidence_rationale: 'AI scoring unavailable' };
    if (anthropic) {
      score = await scoreFounder(anthropic, founder);
    }

    insertStmt.run(
      founder.name, founder.company, founder.role,
      founder.linkedin_url, founder.email, founder.source,
      score.confidence_score, score.confidence_rationale,
      founder.raw_data
    );
    totalAdded++;
  }

  // Update run log
  db.prepare('UPDATE sourcing_runs SET sources_hit = ?, founders_found = ?, founders_added = ?, founders_deduplicated = ?, errors = ? WHERE id = ?').run(
    JSON.stringify(sourcesHit), totalFound, totalAdded, totalDeduped, JSON.stringify(errors), runId
  );

  // Get top pick for Slack
  const topPick = db.prepare("SELECT name, company, confidence_score FROM sourced_founders WHERE status = 'pending' ORDER BY confidence_score DESC LIMIT 1").get();
  const slackMsg = `*Superior OS Sourcing Run Complete*\n${totalAdded} new founders added overnight (${totalDeduped} duplicates filtered)\n${topPick ? `Top pick: *${topPick.name}*${topPick.company ? ` (${topPick.company})` : ''} — Score: ${topPick.confidence_score}/10` : 'No new founders found'}`;
  await notifySlack(slackMsg);

  console.log(`[Sourcing] Complete: ${totalFound} found, ${totalAdded} added, ${totalDeduped} deduped`);
  return { totalFound, totalAdded, totalDeduped, errors };
}

module.exports = { runSourcingEngine };
