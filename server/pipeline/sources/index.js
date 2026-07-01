/**
 * sources/index.js — the SourceConnector registry + one shared ingest pipeline.
 *
 * Every early-signal source (USPTO trademarks today; SBIR/grants, OpenCorporates, CT
 * logs next) implements a tiny connector { key, label, emits, free, cadence, fetch }.
 * They all flow through ONE pipeline here, so each new source inherits geo-filtering,
 * enrichment, dedup, and persistence for free:
 *
 *   fetch → normalize → geo-filter → enrich (user key) → dedup → persist to the queue
 *
 * Geo-filter honors the user's own criteria (owner = hard Chicago/IL tie; none = open),
 * exactly like discovery. Persisted records carry the connector's signal + its evidence.
 */
const db = require('../../db');
const { userGeoCriteria, geoPartition, hasPreference } = require('../../lib/geoFilter');
const { loadUserApiKeys, assertWithinBudget } = require('../../lib/providerKeys');

const REGISTRY = {};
function register(connector) { REGISTRY[connector.key] = connector; return connector; }
function get(key) { return REGISTRY[key]; }
function list() {
  return Object.values(REGISTRY).map(({ key, label, emits, free, cadence }) => ({
    key, label, emits, free: !!free, cadence: cadence || 'daily',
  }));
}

// Run one connector for a user. fetch → geo-filter → enrich → dedup → persist.
async function ingest(key, { userId, since = null, enrich = true, persist = true, limit = 50, deps = {} } = {}) {
  const c = REGISTRY[key];
  if (!c) throw Object.assign(new Error(`Unknown source: ${key}`), { status: 404 });
  assertWithinBudget(userId); // throws SpendCapError if the user is over their daily cap

  const criteria = userGeoCriteria(userId);
  const keys = loadUserApiKeys(userId);

  // 1. Fetch raw records (connector-specific, defensive — a failure yields 0, never throws).
  let raw = [];
  try { raw = (await c.fetch({ since, criteria, keys, limit, deps, userId })) || []; }
  catch (e) { return { source: key, fetched: 0, geoKept: 0, enriched: false, persisted: 0, error: e.message }; }

  // 2. Normalize each RawRecord to the common profile shape.
  let profiles = raw.map(r => ({
    name: r.name || null,
    company: r.entity_name || r.company || null,
    role: r.role || null,
    headline: r.headline || r.entity_name || null,
    bio: r.evidence || '',
    linkedin_url: r.linkedin_url || null,
    website_url: r.url || null,
    location_city: r.location_city || null,
    location_state: r.location_state || null,
    _evidence: r.evidence || null,
  }));

  // 3. Partition by geo. Verified ties → deal pipeline; the rest → national frontier watch
  //    (only for connectors that opt in via `nationalWatchlist` AND when the user actually
  //    has a geo preference — otherwise broad mode already passed everyone into `passed`).
  const { passed, rejected } = geoPartition(profiles, criteria);
  const watchOptIn = !!c.nationalWatchlist && hasPreference(criteria);
  const pipelineRows = passed;
  const watchRows = watchOptIn ? rejected : [];
  const geoKept = pipelineRows.length;

  // 4. Enrich + score on the user's key (skipped if no key — degrades to raw records).
  //    Pipeline and watch are enriched independently so their scope tags stay 1:1.
  let enriched = false;
  async function enrichGroup(rows) {
    if (!enrich || !rows.length) return rows;
    const e = await require('../enrichment').enrichProfiles(userId, rows, { feature: `source:${c.key}` });
    if (e) { enriched = true; return e; }
    return rows;
  }
  const pipelineEnriched = await enrichGroup(pipelineRows);
  const watchEnriched = await enrichGroup(watchRows);

  // 5. Dedup (by linkedin, else website, else source+name+company so the daily cron never
  //    re-inserts the same roster company) + persist, tagged by scope.
  let persisted = 0, watchlisted = 0;
  if (persist) {
    const insert = db.prepare(`INSERT INTO sourced_founders
      (user_id, name, company, role, headline, linkedin_url, website_url, source, status, builder_signals, signal_captured_at, unicorn_score, enrichment, company_one_liner, chicago_connection, location_type, list_scope)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'pending', ?, CURRENT_TIMESTAMP, ?, ?, ?, ?, ?, ?)`);
    const byLinkedin = db.prepare('SELECT id FROM sourced_founders WHERE user_id = ? AND LOWER(linkedin_url) = LOWER(?)');
    const byWebsite = db.prepare('SELECT id FROM sourced_founders WHERE user_id = ? AND LOWER(website_url) = LOWER(?)');
    const byIdentity = db.prepare("SELECT id FROM sourced_founders WHERE user_id = ? AND source = ? AND LOWER(name) = LOWER(?) AND LOWER(IFNULL(company,'')) = LOWER(?)");
    const isDupe = (p) => {
      if (p.linkedin_url) return !!byLinkedin.get(userId, p.linkedin_url);
      if (p.website_url) return !!byWebsite.get(userId, p.website_url);
      return !!byIdentity.get(userId, c.key, p.name || p.company || 'Unknown', p.company || '');
    };
    const persistRows = db.transaction((rows, scope) => {
      let n = 0;
      for (const p of rows) {
        try {
          if (isDupe(p)) continue;
          const enr = JSON.stringify({ summary: p.summary || null, why: p.why || null, contactability: p.contactability || null, evidence: p._evidence || null });
          // location_type is what the Pipeline/queue display filter reads (VALID_TIE_TYPES);
          // write the verified IL tie type so IL-tied cohort/YC founders actually surface.
          const tieType = (p.tie && p.tie.type && p.tie.type !== 'broad') ? p.tie.type : null;
          insert.run(userId, p.name || p.company || 'Unknown', p.company || null, p.role || null, p.headline || null,
            p.linkedin_url || null, p.website_url || null, c.key, JSON.stringify([c.emits]),
            p.unicorn_score ?? null, enr, p.why || null, p.chicago_connection || null, tieType, scope);
          n++;
        } catch { /* skip dupes/bad rows */ }
      }
      return n;
    });
    persisted = persistRows(pipelineEnriched, 'pipeline');
    watchlisted = persistRows(watchEnriched, 'watchlist');
  }

  return { source: key, fetched: raw.length, geoKept, watchlisted, enriched, persisted, results: pipelineEnriched.slice(0, limit) };
}

// Run every registered connector for a user (used by the daily cron). Dormant connectors
// (e.g. USPTO without a key) simply return 0 and are harmless.
async function ingestAll({ userId, since = null } = {}) {
  const out = [];
  for (const key of Object.keys(REGISTRY)) {
    try { out.push(await ingest(key, { userId, since })); }
    catch (e) { out.push({ source: key, error: e.message }); }
  }
  return out;
}

// ── Register connectors ──
register(require('./uspto-trademark'));
register(require('./yc-directory'));
register(require('./a16z-speedrun')); // directory-based (structured API), like YC
register(require('./il-school-discovery')); // highest-yield IL source: school-anchored search
for (const c of require('./cohort-rosters').connectors) register(c);

module.exports = { register, get, list, ingest, ingestAll, REGISTRY };
