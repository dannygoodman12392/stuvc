/**
 * cohortDiscovery.js — resolve the members of a named builder program (Thiel Fellows, Z Fellows,
 * Neo, The Residency, …) to FOUNDER-level records, via web/people search.
 *
 * Why not scrape the program sites? Their rosters aren't fetchable — the pages are SPAs whose
 * member lists load from private client-side APIs (verified), and the static HTML lists only
 * mentors/investors. So we find the actual people the same way Stu's discovery engine does:
 * Exa "people" search for e.g. `"Thiel Fellow" founder`. Each result comes back with the person's
 * web bio, which is exactly what the shared geo gate reads to detect an IL tie (school / hometown
 * / prior work) — the same founder-level matching that powers the YC connector.
 *
 * Precision guard: an Exa hit only counts if the cohort marker actually appears in the person's
 * profile text (so an article that merely mentions "Thiel Fellows" doesn't create a phantom
 * founder). Returns RawRecords for the shared source pipeline to geo-route, enrich, and persist.
 */
const { extractProfile, looksLikePerson, realExaSearch } = require('../pipeline/discovery-engine');

// Run a program's queries through Exa, keep real people whose bio confirms the cohort, dedupe.
async function cohortDiscover({ exaKey, queries, markers = [], cohortLabel, perQuery = 12, deps = {} } = {}) {
  if (!exaKey || !queries || !queries.length) return [];
  const search = deps.exaSearch || realExaSearch;
  const seen = new Set();
  const out = [];
  for (const q of queries) {
    let results = [];
    try { const r = await search(exaKey, q, perQuery); results = (r && r.results) || []; }
    catch { results = []; }
    for (const r of results) {
      const p = extractProfile(r);
      if (!looksLikePerson(p.name)) continue;
      const text = `${p.headline || ''} ${p.bio || ''}`.toLowerCase();
      // Require the cohort marker in the person's own text — not just the search query.
      const marker = markers.find(m => text.includes(m));
      if (markers.length && !marker) continue;
      // Precision guard: reject when the text says the person RUNS/serves the program (mentor,
      // director, scout, program manager) rather than being a member — e.g. "cohort director,
      // neo accelerator", "help identify and mentor neo scholars". Check the words just before
      // the marker, where that relationship is stated.
      if (marker) {
        const idx = text.indexOf(marker);
        const before = text.slice(Math.max(0, idx - 40), idx);
        if (/\b(mentor|director|head of|manages?|managing|scout|advisor to|advises|partnered? with|identify and|running|program (?:manager|lead|director)|community (?:manager|lead))\b[\s,–—|·-]*$/.test(before)) continue;
      }
      const key = (p.linkedin_url || p.name).toLowerCase().trim();
      if (seen.has(key)) continue;
      seen.add(key);
      out.push({
        name: p.name,
        entity_name: null,
        role: 'Founder',
        headline: p.headline || cohortLabel,
        // The person's web bio drives the IL tie (school/hometown/work), like a YC founder bio.
        bio: p.bio || p.headline || '',
        linkedin_url: p.linkedin_url || null,
        website_url: p.website_url || null,
        location_city: null,
        location_state: null,
        evidence: `${cohortLabel} — ${(p.headline || '').slice(0, 120)}`.trim(),
        raw: r,
      });
    }
  }
  return out;
}

module.exports = { cohortDiscover };
