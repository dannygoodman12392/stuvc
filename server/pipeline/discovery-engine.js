/**
 * discovery-engine.js — active discovery of unicorn-builder profiles from the live web.
 *
 * Solves the "empty shelf" problem: a brand-new user can ask "find me YC founders who
 * just left" and get fresh people immediately, without first running a full sourcing
 * sweep. Given one or more builder signals, we build targeted web queries, search (Exa),
 * extract lightweight profiles, run the deterministic signal detectors to keep only real
 * matches (with evidence), and optionally persist them into the user's account so search
 * and monitors stay stocked.
 *
 * Cost: Exa-only (signal detection is deterministic — no LLM). Billed to the user's own
 * Exa key and counted toward their daily spend cap. No key → a clear, actionable error.
 *
 * `deps` is injectable ({ exaSearch }) so tests run without network.
 */
const https = require('https');
const db = require('./../db');
const { resolveKey, assertWithinBudget, recordCost, SpendCapError } = require('../lib/providerKeys');
const { detectSignals, VALID_SIGNAL_KEYS, UNICORN_FACTORIES } = require('../lib/builderSignals');
const { userGeoCriteria, geoFilter, locationQueryHint } = require('../lib/geoFilter');

class NoKeyError extends Error {
  constructor(provider) { super(`No ${provider} key configured. Add it in Settings to discover new people — it bills your account, not the platform.`); this.code = 'no_key'; this.provider = provider; this.status = 400; }
}

const EST_EXA_COST_PER_SEARCH = 0.005; // rough, for the spend cap only

function httpPost(url, headers, body) {
  return new Promise((resolve, reject) => {
    const parsed = new URL(url);
    const data = JSON.stringify(body);
    const req = https.request({
      hostname: parsed.hostname, path: parsed.pathname + parsed.search, method: 'POST',
      headers: { ...headers, 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(data) },
    }, (res) => {
      let out = '';
      res.on('data', c => out += c);
      res.on('end', () => { try { resolve({ status: res.statusCode, data: JSON.parse(out) }); } catch { resolve({ status: res.statusCode, data: out }); } });
    });
    req.on('error', reject); req.write(data); req.end();
  });
}

async function realExaSearch(apiKey, query, numResults = 15) {
  const resp = await httpPost('https://api.exa.ai/search', { 'x-api-key': apiKey }, {
    query, type: 'auto', num_results: numResults, category: 'people',
    contents: { text: { max_characters: 4000 } },
  });
  if (resp.status !== 200) return { results: [], error: `Exa HTTP ${resp.status}` };
  return { results: resp.data.results || [] };
}

// ── Signal → web query templates. Freeform `query` is appended to each. ──
const FACTORIES_OR = UNICORN_FACTORIES.slice(0, 12).join(' OR ');
const QUERY_TEMPLATES = {
  just_departed: (o) => o.fromTier === 'factory'
    ? [`former founding engineer ${FACTORIES_OR} left building something new`, `ex ${FACTORIES_OR} early employee now founder`]
    : o.fromTier === 'yc'
      ? [`"ex-founder" OR "former founder" Y Combinator startup left building new`, `YC alum founder left company now working on something new`]
      : [`founder recently left their startup building something new`, `"ex-founder" OR "former CEO" now building`],
  stealth_building: () => [`founder "stealth" "building something new" startup`, `"working on something new" ex-founder stealth`],
  founder_factory_alum: () => [`"founding engineer" OR "first engineer" ${FACTORIES_OR}`, `early employee ${FACTORIES_OR} now founder`],
  repeat_founder: () => [`"second-time founder" previously founded exited startup`, `serial founder "previous exit" building again`],
  breakout_builder: () => [`open source maintainer founder "building in public"`, `indie hacker creator notable github project founder`],
  credentialed_outlier: () => [`"Thiel Fellow" OR "Forbes 30 under 30" founder startup`, `top PhD researcher commercializing founder`],
  fresh_incorporation: () => [`founder just incorporated stealth startup 2025 "a16z speedrun" OR "Y Combinator" OR "Z Fellows"`, `newly founded startup co-founder stealth`],
};

function buildQueries(signals, query, opts = {}) {
  const types = (signals && signals.length) ? signals : ['just_departed'];
  const out = [];
  for (const t of types) {
    const tmpl = QUERY_TEMPLATES[t];
    if (!tmpl) continue;
    const tier = (opts[t] && opts[t].fromTier) || 'any';
    for (const base of tmpl({ fromTier: tier })) out.push(query ? `${base} ${query}` : base);
  }
  return [...new Set(out)];
}

// Heuristic profile extraction from an Exa "people" result.
function extractProfile(r) {
  const title = (r.title || '').trim();
  // Titles look like "Jane Doe - Founder at Acme | LinkedIn" — split name from the rest,
  // dropping the boilerplate "LinkedIn" segment.
  const seg = title.split(/\s[-–|]\s/).map(s => s.trim()).filter(s => s && !/^linkedin$/i.test(s));
  const name = (seg[0] || '').trim();
  const headline = seg.slice(1).join(' — ').trim();
  const url = r.url || '';
  return {
    name: name || (r.author || '').trim(),
    headline: headline || '',
    linkedin_url: /linkedin\.com/i.test(url) ? url : null,
    website_url: /linkedin\.com/i.test(url) ? null : (url || null),
    bio: (r.text || '').slice(0, 2000),
    source: 'discovery',
  };
}

function looksLikePerson(name) {
  if (!name || name.length < 3 || name.length > 60) return false;
  if (!/[a-zA-Z]/.test(name)) return false;
  // At least two words, not a company/page title.
  return name.trim().split(/\s+/).length >= 2 && !/\b(inc|llc|ltd|corp|jobs|careers|home)\b/i.test(name);
}

// Persist a discovered match into the user's account (deduped by linkedin_url), so the
// shelf fills up and monitors/local search can see it next time.
function persistMatch(userId, target, p) {
  const table = target === 'talent' ? 'talent_candidates' : 'sourced_founders';
  if (p.linkedin_url) {
    const dupe = db.prepare(`SELECT id FROM ${table} WHERE user_id = ? AND LOWER(linkedin_url) = LOWER(?) ${target === 'talent' ? 'AND is_deleted = 0' : ''}`).get(userId, p.linkedin_url);
    if (dupe) return dupe.id;
  }
  const signalKeys = JSON.stringify(p._signalKeys || (p.matched_signals || []).map(s => s.key));
  const enrichment = JSON.stringify({ summary: p.summary || null, why: p.why || null, contactability: p.contactability || null });
  if (target === 'talent') {
    return db.prepare(
      `INSERT INTO talent_candidates (user_id, name, headline, current_company, current_role, linkedin_url, website_url, source, status, builder_signals, unicorn_score, enrichment, one_liner)
       VALUES (?, ?, ?, ?, ?, ?, ?, 'discovery', 'new', ?, ?, ?, ?)`
    ).run(userId, p.name, p.headline, p.company || null, p.role || null, p.linkedin_url, p.website_url, signalKeys, p.unicorn_score ?? null, enrichment, p.why || null).lastInsertRowid;
  }
  return db.prepare(
    `INSERT INTO sourced_founders (user_id, name, company, role, headline, linkedin_url, website_url, source, status, builder_signals, signal_captured_at, unicorn_score, enrichment, company_one_liner, chicago_connection)
     VALUES (?, ?, ?, ?, ?, ?, ?, 'discovery', 'pending', ?, CURRENT_TIMESTAMP, ?, ?, ?, ?)`
  ).run(userId, p.name, p.company || null, p.role || null, p.headline, p.linkedin_url, p.website_url, signalKeys, p.unicorn_score ?? null, enrichment, p.why || null, p.chicago_connection || null).lastInsertRowid;
}

// Main entry. Returns { matched: [...], scanned, persisted, queries }.
async function discover({ userId, signals = [], query = '', limit = 25, persist = true, target = 'sourcing', opts = {}, enrich = true, deps = {} } = {}) {
  assertWithinBudget(userId); // throws SpendCapError if over cap

  const exaKey = resolveKey(userId, 'exa');
  if (!exaKey) throw new NoKeyError('Exa');

  const types = signals.filter(s => VALID_SIGNAL_KEYS.includes(s));
  // Honor the user's location criteria: bias the web queries toward their locations
  // (for you, Chicago/IL), then hard-filter results below. No preference set = open.
  const criteria = userGeoCriteria(userId);
  const queries = buildQueries(types, (query + locationQueryHint(criteria)).trim(), opts);
  const exaSearch = deps.exaSearch || realExaSearch;

  // Run the queries in parallel (fan-out is the slow part) and flatten.
  const perQuery = Math.min(20, Math.ceil((limit * 2) / Math.max(1, queries.length)) + 5);
  const settled = await Promise.all(queries.map(async (q) => {
    recordCost(userId, { provider: 'exa', feature: 'discovery', estCostUsd: EST_EXA_COST_PER_SEARCH });
    try { const r = await exaSearch(exaKey, q, perQuery); return r.error ? [] : r.results; }
    catch { return []; }
  }));
  const raw = settled.flat();

  // Extract → dedupe → detect signals → keep matches.
  const seen = new Set();
  const matched = [];
  for (const r of raw) {
    const p = extractProfile(r);
    if (!looksLikePerson(p.name)) continue;
    const key = (p.linkedin_url || p.name).toLowerCase().trim();
    if (seen.has(key)) continue;
    seen.add(key);

    const { matched: sigs } = detectSignals(p, { types: types.length ? types : VALID_SIGNAL_KEYS, source: target, opts });
    if (!sigs.length) continue; // only return real signal matches
    p._signalKeys = sigs.map(s => s.key);
    matched.push({ ...p, matched_signals: sigs, confidence: sigs[0].confidence });
  }
  matched.sort((a, b) => b.confidence - a.confidence);
  // Geo-gate to the user's criteria BEFORE enrichment (so we never spend the LLM key
  // scoring someone we'd drop). Owner = verified IL tie required; no preference = all pass.
  const geoMatched = geoFilter(matched, criteria);
  let top = geoMatched.slice(0, limit);

  // Analyst-grade enrichment: clean fields + 1-line "why" + 0-100 unicorn score, ranked.
  // Degrades to the deterministic signal output if the user has no Anthropic key.
  let enriched = false;
  if (enrich !== false && top.length) {
    const enrichFn = deps.enrichProfiles || require('./enrichment').enrichProfiles;
    const e = await enrichFn(userId, top, { context: query, feature: 'discovery-enrich' });
    if (e) { top = e; enriched = true; }
  }

  let persisted = 0;
  if (persist && top.length) {
    const tx = db.transaction((rows) => {
      for (const p of rows) { try { persistMatch(userId, target, p); persisted++; } catch { /* skip dupes/errors */ } }
    });
    tx(top);
  }

  return { matched: top, scanned: raw.length, persisted, queries, enriched };
}

module.exports = { discover, buildQueries, extractProfile, NoKeyError };
