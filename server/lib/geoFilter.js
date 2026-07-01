/**
 * geoFilter.js — one geography gate for discovery and every data source.
 *
 * Honors each user's OWN location criteria (Settings → Sourcing Criteria):
 *   - Owner (Danny) has Chicago/IL locations + schools set → results are HARD-filtered
 *     to a verified IL tie (drops the rest), exactly like the web Sourcing queue.
 *   - A user with no locations/schools set → broad mode, everyone passes (open search).
 *   - A user with their own city set (e.g. NYC) → filtered to that.
 *
 * Reuses the sourcing engine's battle-tested verifyLocation (with its false-geo
 * stripping and tie-type logic) so there's exactly one definition of "has a tie."
 */
const { verifyLocation, loadUserCriteria } = require('../pipeline/sourcing-engine');

// { locations: [...], schools: [...] } for the user; empty arrays mean "no preference".
function userGeoCriteria(userId) {
  const c = loadUserCriteria(userId);
  return { locations: c.locations || [], schools: c.schools || [] };
}

function hasPreference(criteria) {
  return (criteria.locations && criteria.locations.length > 0) || (criteria.schools && criteria.schools.length > 0);
}

// Assemble the text verifyLocation reads. Structured city/state become a "Based in …"
// phrase so a filing whose owner address is "Chicago, IL" reliably matches.
function profileText(p) {
  const loc = [p.location_city, p.location_state].filter(Boolean).join(', ');
  const locPhrase = loc ? `Based in ${loc}. ` : '';
  const signalText = Array.isArray(p.matched_signals) ? p.matched_signals.map(s => s.evidence || s.label || '').join(' ') : '';
  return (locPhrase + [p.headline, p.bio, p.company, p.role, p.chicago_connection, signalText].filter(Boolean).join(' • ')).trim();
}

// Verify one profile against the criteria. Returns verifyLocation's result.
function checkLocation(profile, criteria) {
  return verifyLocation(profileText(profile), profile.headline || '', criteria);
}

// Filter rows to those that pass, attaching the verified tie as chicago_connection.
// criteria with no preference → all pass (broad mode).
function geoFilter(rows, criteria) {
  const out = [];
  for (const r of rows) {
    const tie = checkLocation(r, criteria);
    if (!tie.verified) continue;
    out.push({
      ...r,
      tie,
      chicago_connection: r.chicago_connection || (tie.type !== 'broad' ? `${tie.type}: ${tie.location}` : null),
    });
  }
  return out;
}

// Partition rows into { passed, rejected } against the criteria, instead of dropping the
// rejected ones. `passed` are verified ties (deal pipeline); `rejected` are the rest, kept
// intact for a national "frontier watch". When the user has NO preference (broad mode),
// everyone verifies, so rejected is empty and behavior matches geoFilter exactly.
function geoPartition(rows, criteria) {
  const passed = [];
  const rejected = [];
  for (const r of rows) {
    const tie = checkLocation(r, criteria);
    if (tie.verified) {
      passed.push({
        ...r,
        tie,
        chicago_connection: r.chicago_connection || (tie.type !== 'broad' ? `${tie.type}: ${tie.location}` : null),
      });
    } else {
      rejected.push({ ...r, tie });
    }
  }
  return { passed, rejected };
}

// A parenthetical to bias a web query toward the user's locations (discovery only).
function locationQueryHint(criteria) {
  const locs = (criteria.locations || []).slice(0, 6);
  return locs.length ? ` (${locs.join(' OR ')})` : '';
}

module.exports = { userGeoCriteria, hasPreference, checkLocation, geoFilter, geoPartition, locationQueryHint, profileText };
