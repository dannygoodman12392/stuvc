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
const { userGeoCriteria, geoFilter } = require('../../lib/geoFilter');
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
  try { raw = (await c.fetch({ since, criteria, keys, limit, deps })) || []; }
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

  // 3. Geo-filter to the user's criteria (owner = verified IL tie; no preference = all pass).
  profiles = geoFilter(profiles, criteria);
  const geoKept = profiles.length;

  // 4. Enrich + score on the user's key (skipped if no key — degrades to raw records).
  let enriched = false;
  if (enrich && profiles.length) {
    const e = await require('../enrichment').enrichProfiles(userId, profiles, { feature: `source:${c.key}` });
    if (e) { profiles = e; enriched = true; }
  }

  // 5. Dedup (by linkedin/website/name) + persist to the user's sourced queue.
  let persisted = 0;
  if (persist && profiles.length) {
    const insert = db.prepare(`INSERT INTO sourced_founders
      (user_id, name, company, role, headline, linkedin_url, website_url, source, status, builder_signals, signal_captured_at, unicorn_score, enrichment, company_one_liner, chicago_connection)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'pending', ?, CURRENT_TIMESTAMP, ?, ?, ?, ?)`);
    const tx = db.transaction((rows) => {
      for (const p of rows) {
        try {
          if (p.linkedin_url) {
            const dupe = db.prepare('SELECT id FROM sourced_founders WHERE user_id = ? AND LOWER(linkedin_url) = LOWER(?)').get(userId, p.linkedin_url);
            if (dupe) continue;
          }
          const enr = JSON.stringify({ summary: p.summary || null, why: p.why || null, contactability: p.contactability || null, evidence: p._evidence || null });
          insert.run(userId, p.name || p.company || 'Unknown', p.company || null, p.role || null, p.headline || null,
            p.linkedin_url || null, p.website_url || null, c.key, JSON.stringify([c.emits]),
            p.unicorn_score ?? null, enr, p.why || null, p.chicago_connection || null);
          persisted++;
        } catch { /* skip dupes/bad rows */ }
      }
    });
    tx(profiles);
  }

  return { source: key, fetched: raw.length, geoKept, enriched, persisted, results: profiles.slice(0, limit) };
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

module.exports = { register, get, list, ingest, ingestAll, REGISTRY };
