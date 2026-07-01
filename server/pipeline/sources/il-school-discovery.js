/**
 * il-school-discovery.js — SourceConnector: IL-rooted founders via school-anchored search.
 *
 * The single highest-yield source for a Chicago-first thesis. Instead of chasing programs, it
 * searches directly for founders who name an Illinois school on their LinkedIn (UChicago, UIUC,
 * Northwestern, IIT) or are building in Chicago. A live sprint found ~50 in-thesis founders this
 * way — more than every program combined — because the tie Danny cares about most (school) is
 * exactly what people self-declare. Uses the same people-search + precision guard as the cohort
 * connectors; the shared geo gate then confirms the IL tie and routes to the pipeline.
 *
 * BYOK (user's Exa key), spend-capped; dormant without a key. Some hits are professors/execs, not
 * pre-seed founders — the downstream enrichment/unicorn score filters those, and Danny can sift by
 * caliber/fit in the Pipeline.
 */
const { cohortDiscover } = require('../../lib/cohortDiscovery');

let recordCost;
try { ({ recordCost } = require('../../lib/providerKeys')); } catch { recordCost = () => {}; }

const QUERIES = (process.env.IL_SCHOOL_QUERIES || [
  'University of Chicago founder building startup',
  'UIUC University of Illinois founder startup',
  'Northwestern University founder startup',
  'Illinois Institute of Technology founder startup',
  'Chicago founder building startup 2025 2026',
].join('||')).split('||').map(s => s.trim()).filter(Boolean);

// A hit must name an IL school or an IL location in its own text (precision guard).
const MARKERS = ['university of chicago', 'uchicago', 'university of illinois', 'uiuc', 'urbana',
  'northwestern', 'illinois institute', 'illinois tech', 'chicago, il', 'chicago, illinois',
  ', illinois', 'evanston', 'champaign', 'naperville'];

async function fetch({ keys = {}, limit = 15, deps = {}, userId } = {}) {
  const exaKey = (keys && keys.exa) || deps.exaKey || (deps.exaSearch ? 'test' : null);
  if (!exaKey) return []; // dormant without an Exa key (BYOK)
  const recs = await cohortDiscover({ exaKey, queries: QUERIES, markers: MARKERS, cohortLabel: 'IL school', perQuery: Math.min(15, limit), deps });
  if (userId != null) for (let i = 0; i < QUERIES.length; i++) recordCost(userId, { provider: 'exa', feature: 'source:il_school', estCostUsd: 0.005 });
  return recs;
}

module.exports = {
  key: 'il_school_discovery',
  label: 'Illinois school founders',
  emits: 'il_school',
  free: false,
  cadence: 'daily',
  nationalWatchlist: true,
  fetch,
  QUERIES, // exported for tests
  MARKERS,
};
