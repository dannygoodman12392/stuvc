'use strict';
// ══════════════════════════════════════════════════════════════════════════
// The free read: what the public record says about a company, with no key, no
// credits, and no permission needed.
//
// Danny: "I want to be able to click on Pipeline, check out the pipeline, click a
// founder/company and be able to get a lot of insight into how the company is
// doing. How many people/are they hiring and growing, what you could learn from
// the company site and crunchbase, etc..."
//
// Two readers, run together because they answer one question between them:
//
//   lib/edgar.js   -> did they raise, how much, when, and who's on the board
//   lib/hiring.js  -> are they hiring, and for what
//
// EnrichLayer already covers headcount and growth (company-enrich.js) but it costs
// 2 credits + 4 per employee and needs a resolved LinkedIn URL. This costs nothing
// and needs a company name and a website — which every card already has. That's why
// it's a separate blob and a separate button: the free half should never be held
// hostage by the expensive one.
//
// ── PARTIAL IS THE NORMAL RESULT ──
// A pre-seed company usually has no Form D and no job board. Both readers are
// built to say "I don't know" precisely, and this service must not launder those
// two honest unknowns into one vague empty state. Each half keeps its own reason
// string, and the card shows it.
// ══════════════════════════════════════════════════════════════════════════

const db = require('../db');
const { formDFor } = require('../lib/edgar');
const { hiringFor } = require('../lib/hiring');

/**
 * Read the public record for one card. Never throws — a reader that dies returns
 * its failure as a reason, because "EDGAR timed out" and "they never raised" must
 * never render as the same thing.
 */
async function readPublicRecord({ company, founderName, website, deps = {} }) {
  const [funding, hiring] = await Promise.all([
    formDFor({ company, founderName, deps: deps.edgar || {} })
      .catch((e) => ({ found: false, reason: `EDGAR read failed: ${e.message}` })),
    hiringFor({ company, website, deps: deps.hiring || {} })
      .catch((e) => ({ found: false, reason: `careers read failed: ${e.message}` })),
  ]);

  return { funding, hiring, fetched_at: new Date().toISOString() };
}

function savePublicRecord(founderId, blob) {
  db.prepare('UPDATE founders SET company_public = ?, company_public_at = CURRENT_TIMESTAMP WHERE id = ?')
    .run(JSON.stringify(blob), founderId);
}

/**
 * The whole live board, for the nightly job. Free, so unlike enrich-backfill there
 * is no spend ceiling to respect — only politeness to the SEC and to a few hundred
 * marketing sites.
 *
 * Serial on purpose. lib/edgar.js self-throttles to stay inside the SEC's fair-use
 * limit, and firing 100 cards at it concurrently is exactly how a polite client
 * stops being polite by accident and gets the whole deploy's IP blocked.
 */
async function publicRecordBackfill({ userId, limit, offset = 0, deps = {} } = {}) {
  const rows = db.prepare(`
    SELECT id, company, name, website_url
      FROM founders
     WHERE created_by = ? AND is_deleted = 0
       AND company IS NOT NULL AND TRIM(company) != ''
     ORDER BY id
     LIMIT ? OFFSET ?
  `).all(userId, limit || 500, offset);

  const out = { read: 0, with_funding: 0, with_hiring: 0, skipped: 0, results: [] };
  for (const r of rows) {
    const blob = await readPublicRecord({
      company: r.company, founderName: r.name, website: r.website_url, deps,
    });
    savePublicRecord(r.id, blob);
    out.read++;
    if (blob.funding.found) out.with_funding++;
    if (blob.hiring.found) out.with_hiring++;
    out.results.push({
      id: r.id,
      company: r.company,
      funding: blob.funding.found ? `$${(blob.funding.latest.amount_sold || 0).toLocaleString()}` : blob.funding.reason,
      hiring: blob.hiring.found ? `${blob.hiring.role_count} roles` : blob.hiring.reason,
    });
  }
  return out;
}

module.exports = { readPublicRecord, savePublicRecord, publicRecordBackfill };
