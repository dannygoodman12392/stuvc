/**
 * geoFilter.js — one geography gate for discovery and every data source.
 *
 *   - An ILLINOIS user (Danny) → lib/ilTie.js is the authority. See below.
 *   - A user with no locations/schools set → broad mode, everyone passes.
 *   - A user with their own city set (e.g. NYC) → the engine's verifyLocation.
 *
 * ── WHY ILLINOIS HAS ITS OWN GATE ──
 * This file used to route Danny through verifyLocation(criteria), which reads the
 * tie out of `criteria.schools` — a user setting. On 2026-07-15 that setting held
 * 48 schools: 12 Illinois and 36 national elite, because one list was doing two
 * jobs (tie AND pedigree). So Stanford established a Chicago tie, and 55 of the
 * 85 founders on the IL board had no Illinois connection at all.
 *
 * An Illinois tie is a FACT ABOUT ILLINOIS. It must not be configurable, or the
 * next person to add "Stanford" to a pedigree list silently re-breaks the board.
 * Pedigree still matters — it lives in the caliber score, where it belongs.
 */
const { verifyLocation, loadUserCriteria } = require('../pipeline/sourcing-engine');
const ilTie = require('./ilTie');

// { locations: [...], schools: [...] } for the user; empty arrays mean "no preference".
function userGeoCriteria(userId) {
  const c = loadUserCriteria(userId);
  return { locations: c.locations || [], schools: c.schools || [] };
}

function hasPreference(criteria) {
  return (criteria.locations && criteria.locations.length > 0) || (criteria.schools && criteria.schools.length > 0);
}

// Is this user sourcing Illinois? Keyed on LOCATIONS only — never schools, since
// a school list is exactly the thing that got polluted.
function isIllinoisUser(criteria) {
  const locs = (criteria.locations || []).map((l) => String(l).toLowerCase());
  return locs.some((l) => l === 'illinois' || l === 'chicago' || ilTie.IL_PLACES.includes(l));
}

// Assemble the text verifyLocation reads. Structured city/state become a "Based in …"
// phrase so a filing whose owner address is "Chicago, IL" reliably matches.
//
// NOTE: `chicago_connection` is deliberately NOT read here anymore. It is the field
// this gate WRITES, and feeding it back in let a bad tie re-verify itself on every
// run — which is why "school_alumni: Stanford" survived four months of re-ingests.
// A verifier that reads its own output isn't verifying anything.
function profileText(p) {
  const loc = [p.location_city, p.location_state].filter(Boolean).join(', ');
  const locPhrase = loc ? `Based in ${loc}. ` : '';
  const signalText = Array.isArray(p.matched_signals) ? p.matched_signals.map(s => s.evidence || s.label || '').join(' ') : '';
  return (locPhrase + [p.headline, p.bio, p.company, p.role, p.notable_background, p.previous_companies, signalText].filter(Boolean).join(' • ')).trim();
}

// Verify one profile against the criteria.
// Returns the engine's { verified, type, location } shape either way, so every
// caller downstream is unchanged.
function checkLocation(profile, criteria) {
  if (isIllinoisUser(criteria)) {
    const t = ilTie.verifyIlTie(ilTie.profileText(profile));
    return t.verified
      ? { verified: true, type: t.type, location: t.place, evidence: t.evidence, derived: !!t.derived }
      : { verified: false, type: null, location: null, reason: t.reason };
  }
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
        // Rebuild from the CURRENT verdict rather than preferring the stored value.
        // `r.chicago_connection ||` meant a row that already carried a bad tie kept
        // it forever, even once the gate had learned better. The evidence rides
        // along so the tie can be read and overruled.
        chicago_connection:
          tie.type !== 'broad'
            ? `${tie.type}: ${tie.location}${tie.evidence ? ` — ${tie.evidence}` : ''}`.slice(0, 400)
            : null,
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
