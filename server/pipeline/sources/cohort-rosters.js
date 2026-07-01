/**
 * cohort-rosters.js — SourceConnectors for named high-signal builder programs, resolved to
 * FOUNDER level: Thiel Fellows, Z Fellows, Neo, a16z Speedrun, The Residency, Emergent Ventures.
 *
 * These programs don't publish a fetchable roster (their sites are SPAs whose member lists load
 * from private client-side APIs; the static HTML lists only mentors). So — exactly like the YC
 * connector resolves founders from company pages — we resolve program members to people via web
 * search (Exa "people"), keeping only hits whose own bio confirms the cohort. Each person's bio
 * then flows through the shared geo gate, which detects the IL tie Danny cares about most (went
 * to UChicago / U of I / Northwestern, is from here, or worked here) — the founder-level match,
 * not a company location. IL ties → deal pipeline; the rest → national frontier watch.
 *
 * BYOK: the search runs on the user's own Exa key, spend-capped. No Exa key → the connector is
 * dormant (returns []), so it never breaks a run. Adding a program is a one-line PROGRAMS entry.
 */
const { cohortDiscover } = require('../../lib/cohortDiscovery');
const { locationQueryHint } = require('../../lib/geoFilter');

let recordCost;
try { ({ recordCost } = require('../../lib/providerKeys')); } catch { recordCost = () => {}; }

function makeCohortConnector({ key, label, emits, cohortLabel, markers, baseQueries }) {
  async function fetch({ criteria = {}, keys = {}, limit = 25, deps = {}, userId } = {}) {
    const exaKey = (keys && keys.exa) || deps.exaKey || (deps.exaSearch ? 'test' : null);
    if (!exaKey) return []; // dormant without an Exa key (BYOK)
    // National queries + one location-biased variant (lifts IL/pipeline yield; the geo gate still
    // splits results, so non-IL hits are not lost — they land on the national watchlist).
    const queries = baseQueries.slice();
    const hint = locationQueryHint(criteria);
    if (hint) queries.push(`${baseQueries[0]}${hint}`);
    const recs = await cohortDiscover({ exaKey, queries, markers, cohortLabel, perQuery: Math.min(15, limit), deps });
    if (userId != null) for (let i = 0; i < queries.length; i++) recordCost(userId, { provider: 'exa', feature: `cohort:${key}`, estCostUsd: 0.005 });
    return recs;
  }
  return { key, label, emits, free: false, cadence: 'weekly', nationalWatchlist: true, fetch };
}

// One line per program. markers must appear in a person's own bio for the hit to count.
const PROGRAMS = [
  { key: 'thiel_fellows', label: 'Thiel Fellows', emits: 'thiel_fellow', cohortLabel: 'Thiel Fellow',
    markers: ['thiel fellow', 'thiel fellowship'],
    baseQueries: ['"Thiel Fellow" founder startup', '"Thiel Fellowship" founder building'] },
  { key: 'z_fellows', label: 'Z Fellows', emits: 'z_fellow', cohortLabel: 'Z Fellows',
    markers: ['z fellows', 'zfellows'],
    baseQueries: ['"Z Fellows" founder startup', '"Z Fellows" alum founder building'] },
  { key: 'neo_scholars', label: 'Neo', emits: 'neo_scholar', cohortLabel: 'Neo Scholar/Founder',
    markers: ['neo scholar', 'neo cohort', 'neo accelerator', 'neo fellowship'],
    baseQueries: ['"Neo scholar" founder startup', '"Neo accelerator" founder building'] },
  { key: 'the_residency', label: 'The Residency', emits: 'the_residency', cohortLabel: 'The Residency',
    markers: ['the residency', 'theresidency', 'res.is'],
    baseQueries: ['"The Residency" founder builder startup', 'theresidency.co founder building'] },
  { key: 'emergent_ventures', label: 'Emergent Ventures', emits: 'emergent_ventures', cohortLabel: 'Emergent Ventures',
    markers: ['emergent ventures'],
    baseQueries: ['"Emergent Ventures" grantee founder', '"Emergent Ventures" fellowship founder startup'] },
];

const connectors = PROGRAMS.map(makeCohortConnector);

module.exports = { connectors, makeCohortConnector, PROGRAMS };
