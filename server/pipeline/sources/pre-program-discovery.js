/**
 * pre-program-discovery.js — "Breakout Radar": IL-tied builders with program-grade pedigree who
 * DON'T yet carry a program tag. The alpha source — catches the Angelo-from-Jane-Street and the
 * Foosaner-between-companies before YC/Speedrun/Thiel do.
 *
 * The trick that makes it "under the radar": it searches for the profile (stealth / building +
 * elite pedigree), then EXCLUDES anyone whose text shows a program (YC/Speedrun/Thiel/Z-Fellows/
 * Neo/etc.) — the opposite of the cohort connectors. The shared geo gate keeps IL ties; the
 * breakout score (computed at persist for every founder) ranks them by admit-likelihood.
 *
 * BYOK (Exa), spend-capped, dormant without a key. National finds → the frontier watch.
 */
const { realExaSearch, extractProfile, looksLikePerson } = require('../discovery-engine');
const { locationQueryHint } = require('../../lib/geoFilter');

let recordCost;
try { ({ recordCost } = require('../../lib/providerKeys')); } catch { recordCost = () => {}; }

// If any of these appear, the person is ALREADY discovered → exclude. (No outer \b: some
// patterns begin/end with non-word chars like "(yc", which a word boundary would break.)
const PROGRAM = /(y combinator|ycombinator|\(yc[\s;)]|\byc[\s-]?[swfx]\d{2}|thiel fellow|\bz fellows?\b|zfellows|neo scholar|neo accelerator|techstars|entrepreneur first|on deck|south park commons|antler|pear\s?vc|founders inc)/i;
// Must actually be building something.
const BUILDING = /\b(stealth|building something|working on something|founder|co-?founder|founding engineer|\bcto\b|0 to 1|new venture|on leave|dropped out|deferred)\b/i;

const QUERIES = (process.env.PRE_PROGRAM_QUERIES || [
  'University of Chicago student OR recent grad building stealth startup founder',
  'UIUC University of Illinois computer science founder building stealth startup',
  'Northwestern University founder building stealth startup 2025 2026',
  'ex-OpenAI OR ex-Stripe OR ex-Palantir OR ex-Ramp founder Chicago Illinois building stealth',
  'former Google OR Meta OR Two Sigma OR Jane Street OR Citadel engineer Chicago now building startup founder',
  'dropped out OR "on leave" University of Chicago OR UIUC building startup',
  'Illinois founder "building something new" OR "working on something new" stealth',
].join('||')).split('||').map(s => s.trim()).filter(Boolean);

async function fetch({ criteria = {}, keys = {}, limit = 15, deps = {}, userId } = {}) {
  const exaKey = (keys && keys.exa) || deps.exaKey || (deps.exaSearch ? 'test' : null);
  if (!exaKey) return []; // dormant without an Exa key (BYOK)
  const search = deps.exaSearch || realExaSearch;
  const hint = locationQueryHint(criteria);
  const seen = new Set();
  const out = [];
  for (const q of QUERIES) {
    let r;
    try { r = await search(exaKey, (q + hint).trim(), Math.min(15, limit)); } catch { continue; }
    for (const res of (r && r.results) || []) {
      const p = extractProfile(res);
      if (!looksLikePerson(p.name)) continue;
      const text = `${p.headline || ''} ${p.bio || ''}`.toLowerCase();
      if (PROGRAM.test(text)) continue;   // already discovered → skip (this is the whole point)
      if (!BUILDING.test(text)) continue; // must be building
      const key = (p.linkedin_url || p.name).toLowerCase().trim();
      if (seen.has(key)) continue;
      seen.add(key);
      out.push({
        name: p.name,
        entity_name: null,
        role: 'Founder',
        headline: p.headline || 'Building (stealth)',
        bio: p.bio || p.headline || '',
        linkedin_url: p.linkedin_url || null,
        website_url: p.website_url || null,
        location_city: null,
        location_state: null,
        evidence: `Pre-program builder — ${(p.headline || '').slice(0, 120)}`,
        raw: res,
      });
    }
  }
  if (userId != null) for (let i = 0; i < QUERIES.length; i++) recordCost(userId, { provider: 'exa', feature: 'source:pre_program', estCostUsd: 0.005 });
  return out;
}

module.exports = {
  key: 'pre_program',
  label: 'Breakout Radar (pre-program)',
  emits: 'pre_program',
  free: false,
  cadence: 'weekly',
  nationalWatchlist: true,
  fetch,
  QUERIES, // exported for tests
};
