'use strict';
// ══════════════════════════════════════════════════════════════════════════
// Fill the board's company data: resolve LinkedIn, then enrich.
//
// Danny: "I want the same level of insight (for example, company pages on LinkedIn
// show how many people work there and have been hired at these companies over
// time). You can see where the founders previously worked... I'll pay for
// enrichment." And: "make sure you've enriched the data for each company."
//
// He has been paying for nothing. company-enrich hard-requires
// `company_linkedin_url`; 2 of 105 cards had one, so exactly ONE company had ever
// been enriched. Two stages, in order, because the second is blocked on the first:
//
//   1. RESOLVE  — lib/resolve-company-linkedin (Exa). Cheap. Refuses when unsure.
//   2. ENRICH   — pipeline/company-enrich (EnrichLayer). Real credits, so it only
//                 ever runs on a URL stage 1 was willing to stand behind.
//
// ── WHAT THIS DELIBERATELY DOES NOT DO ──
// It does not enrich terminal cards. 86 of 186 are Not Admitted / Pass on
// Investment / Legacy — Danny has already decided, and paying to learn a declined
// company's hiring curve is spending his money to answer a question he closed.
//
// It does not fill gaps it can't prove. A card whose LinkedIn wouldn't resolve
// stays blank, and blank is the honest answer: the alternative is another company's
// roster printed as this one's, which nothing downstream could catch.
//
// ── COST ──
// EnrichLayer bills credits at ~$0.01. A 2-10 person company costs ~12-40 credits
// (~$0.12-0.40) for the profile plus the enriched roster — which is where the start
// dates and prior employers come from. ~30 resolvable live companies ≈ $4-12,
// against a $25/day cap that providerKeys enforces independently. `maxSpendUsd`
// here is a second, local ceiling: a bulk loop is exactly where a cap earns its
// keep, and it stops BEFORE the call that would cross it, not after.
// ══════════════════════════════════════════════════════════════════════════

const db = require('../db');
const { resolveCompanyLinkedIn } = require('../lib/resolve-company-linkedin');
const { enrichCompany, saveCompanyEnrichment } = require('../pipeline/company-enrich');
const { resolveKey } = require('../lib/providerKeys');
const { TERMINAL_STAGES } = require('../lib/airtableVocab');

// Live cards, named company, on the board. `?` placeholders built from the vocab so
// this list can never drift from the one the board uses.
function liveCards(userId) {
  const holes = TERMINAL_STAGES.map(() => '?').join(',');
  return db.prepare(`
    SELECT id, name, company, website_url, company_linkedin_url, company_enrichment
    FROM founders
    WHERE is_deleted = 0 AND created_by = ?
      AND stage_status IS NOT NULL
      AND stage_status NOT IN (${holes})
      AND company IS NOT NULL AND TRIM(company) != ''
    ORDER BY company
  `).all(userId, ...TERMINAL_STAGES);
}

/**
 * ── WHY THIS PAGES ──
 * 96 companies × an Exa lookup each is minutes of work, and a platform proxy kills
 * a synchronous request long before that: the first full run came back 502 while
 * the same call with limit=3 returned in under a second. So the caller walks it in
 * chunks. `offset` is load-bearing rather than cosmetic — `limit` alone re-slices
 * the same first N rows every call, and any card that refuses to resolve (35 of
 * them do, by design) would block the window forever and nothing past it would run.
 *
 * @param {object}  opts
 * @param {boolean} opts.dryRun      Resolve only; never spend an EnrichLayer credit.
 * @param {number}  opts.maxSpendUsd Local ceiling for this run.
 * @param {number}  opts.limit       Cap the number of cards touched.
 * @param {number}  opts.offset      Where to start in the (stably ordered) list.
 */
async function enrichBackfill({ userId = 1, dryRun = false, maxSpendUsd = 15, limit = Infinity, offset = 0 } = {}) {
  const exaKey = resolveKey(userId, 'exa');
  const out = {
    considered: 0,
    resolved: 0, alreadyHadUrl: 0, unresolved: [],
    enriched: 0, alreadyEnriched: 0, enrichFailed: [],
    estSpendUsd: 0, stoppedOnCap: false,
  };

  const all = liveCards(userId);           // ORDER BY company — stable across calls
  out.considered = all.length;
  const end = limit === Infinity ? all.length : offset + limit;
  const rows = all.slice(offset, end);
  out.offset = offset;
  out.batch = rows.length;
  out.done = end >= all.length;            // so the caller knows when to stop paging

  for (const r of rows) {
    // ── 1. Resolve ──
    let url = r.company_linkedin_url;
    if (url) {
      out.alreadyHadUrl++;
    } else {
      if (!exaKey) { out.unresolved.push({ company: r.company, reason: 'no Exa key' }); continue; }
      const res = await resolveCompanyLinkedIn({
        company: r.company, founderName: r.name, website: r.website_url, exaKey,
      });
      if (!res.url) {
        // Recorded with its reason, not swallowed. The reasons are the to-fix list:
        // "one-word name — no corroboration" is fixed by finding the website, which
        // is a different and cheaper job than loosening the matcher.
        out.unresolved.push({ id: r.id, company: r.company, reason: res.reason, candidates: res.candidates });
        continue;
      }
      url = res.url;
      out.resolved++;
      if (!dryRun) {
        db.prepare('UPDATE founders SET company_linkedin_url = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?')
          .run(url, r.id);
      }
    }

    // ── 2. Enrich ──
    if (r.company_enrichment) { out.alreadyEnriched++; continue; }
    if (dryRun) continue;

    // Stop BEFORE the call that would cross the ceiling. Checking after is how a cap
    // reports a number it already spent.
    const EST_PER_COMPANY = 0.4; // worst case for Danny's 2-10 person book
    if (out.estSpendUsd + EST_PER_COMPANY > maxSpendUsd) { out.stoppedOnCap = true; break; }

    try {
      const blob = await enrichCompany(url, { userId });
      if (!blob) { out.enrichFailed.push({ company: r.company, reason: 'LinkedIn returned nothing' }); continue; }
      saveCompanyEnrichment(r.id, blob);
      out.enriched++;
      out.estSpendUsd += EST_PER_COMPANY;
    } catch (e) {
      out.enrichFailed.push({ company: r.company, reason: e.message });
      // A spend-cap error from providerKeys is terminal for the whole run, not just
      // this row — every subsequent call would fail identically.
      if (e.code === 'spend_cap_exceeded') { out.stoppedOnCap = true; break; }
    }
  }
  return out;
}

module.exports = { enrichBackfill, __test: { liveCards } };
