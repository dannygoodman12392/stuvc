'use strict';
// ══════════════════════════════════════════════════════════════════════════
// Make the cards actually know things.
//
// Danny: "We can enrich records with free internet data (LinkedIn, Crunchbase,
// etc), Granola data you have access to, and the notes I just gave me on all these
// companies... I want Harmonic-level insight in the cards so I can have a better
// sense of the company."
//
// He was right that I'd over-indexed on EnrichLayer. It needs a company LinkedIn
// URL, which resolves for only ~26% of the book, so coverage stalled there. None of
// the other three inputs need one:
//
//   HIS NOTES     — already pushed (POST /api/vault-sync/notes). Free.
//   GRANOLA       — 72 calls matched to 59 cards. Free. Pushed via /call-notes.
//   THE OPEN WEB  — the company's own site, read through Exa. Cheap, and 79 cards
//                   already carry a website_url that nothing has ever read.
//
// This service does the two steps those leave open:
//
//   1. READ THE WEB. Ingest each card's website as a `url` source. Exa returns the
//      page text; ingest.js already refuses login walls and error pages, so a card
//      never gains a "source" that is really a sign-in screen.
//
//   2. EXTRACT. Run lib/extract-signals over every source with no signals yet. THIS
//      is what "sort those notes into respective categories" means: a signal is
//      typed (traction | team | product | market | risk | raise | customer) and
//      carries a quote that must appear verbatim in its own source, or
//      lib/signals.js drops it. Categories are the output of reading, not a folder
//      someone files text into.
//
// ── WHY NOT CRUNCHBASE SPECIFICALLY ──
// Danny named it as an example of free data, and its pages are largely paywalled to
// crawlers — Exa returns the teaser, not the round. A "source" that is really a
// paywall prompt is worse than no source: it looks like evidence. The company's own
// site is the free web data that actually reads, and Exa's index covers press and
// launch coverage through the same pipe when the site links it. If a specific
// Crunchbase page matters, Danny can paste the URL onto the card himself.
//
// ── COST ──
// Exa /contents ~$0.001/page. One Claude call per source at temperature 0, ~$0.01-0.03
// depending on length (a 20k-char transcript is the expensive end). ~250 sources ≈
// $3-6. providerKeys' daily cap still applies underneath; maxSpendUsd is a local
// ceiling checked BEFORE the call that would cross it.
// ══════════════════════════════════════════════════════════════════════════

const db = require('../db');
const { ingestUrl } = require('../lib/ingest');
const { extractFrom } = require('../lib/extract-signals');
const signals = require('../lib/signals');

// Cards on the board. Folded co-founders are excluded — same company, and their
// sources belong on the card that represents it.
function boardCards(userId) {
  return db.prepare(`
    SELECT id, name, company, website_url
    FROM founders
    WHERE is_deleted = 0 AND created_by = ?
      AND stage_status IS NOT NULL
      AND represented_by_founder_id IS NULL
    ORDER BY id
  `).all(userId);
}

/** Step 1 — read each card's own website through Exa, once. */
async function ingestWebsites({ userId = 1, limit = Infinity, offset = 0 } = {}) {
  const out = { considered: 0, ingested: 0, alreadyHad: 0, failed: [], done: true };
  const all = boardCards(userId).filter((c) => c.website_url);
  out.considered = all.length;
  const end = limit === Infinity ? all.length : offset + limit;
  out.done = end >= all.length;

  for (const c of all.slice(offset, end)) {
    // recordSource dedupes on content_hash, but checking first saves an Exa call.
    const has = db.prepare(
      "SELECT 1 FROM company_sources WHERE founder_id = ? AND kind = 'url' LIMIT 1"
    ).get(c.id);
    if (has) { out.alreadyHad++; continue; }

    let url = String(c.website_url).trim();
    if (!/^https?:\/\//i.test(url)) url = 'https://' + url;

    try {
      const r = await ingestUrl({ founderId: c.id, url, userId });
      if (r.error) out.failed.push({ company: c.company, url, reason: r.error });
      else out.ingested++;
    } catch (e) {
      out.failed.push({ company: c.company, url, reason: e.message });
    }
  }
  return out;
}

/** Step 2 — turn every unread source into categorized, quote-backed signals. */
async function extractAll({ userId = 1, limit = Infinity, offset = 0, maxSpendUsd = 12 } = {}) {
  const out = {
    considered: 0, extracted: 0, sourcesWithSignals: 0,
    proposed: 0, kept: 0, droppedByGate: 0,
    failed: [], byKind: {}, gateReasons: {}, done: true, stoppedOnCap: false,
  };

  // Only sources on board cards, and only ones nothing has read yet. Re-reading a
  // source that already produced signals would pay Claude to reproduce them.
  const all = db.prepare(`
    SELECT s.id, s.founder_id, s.kind, s.title, s.content_text, s.occurred_at, f.company
    FROM company_sources s
    JOIN founders f ON f.id = s.founder_id
    WHERE f.is_deleted = 0 AND f.created_by = ?
      AND f.stage_status IS NOT NULL
      AND f.represented_by_founder_id IS NULL
      AND s.content_text IS NOT NULL AND LENGTH(s.content_text) >= 40
      AND NOT EXISTS (SELECT 1 FROM company_signals g WHERE g.source_id = s.id)
    ORDER BY s.id
  `).all(userId);

  out.considered = all.length;
  const end = limit === Infinity ? all.length : offset + limit;
  out.done = end >= all.length;

  let spend = 0;
  for (const s of all.slice(offset, end)) {
    // Rough, and deliberately pessimistic: ~4 chars/token in, and the output is
    // small. Stop BEFORE the call that would cross the ceiling.
    const est = Math.max(0.005, (s.content_text.length / 4) * 0.000003 + 0.004);
    if (spend + est > maxSpendUsd) { out.stoppedOnCap = true; break; }

    try {
      const { candidates, error, model } = await extractFrom(s, { userId });
      spend += est;
      if (error) { out.failed.push({ company: s.company, kind: s.kind, reason: error }); continue; }

      out.extracted++;
      out.proposed += candidates.length;

      // recordSignals IS the honesty gate: it drops any claim whose quote isn't
      // verbatim in this source, and any claim carrying a number its own quote
      // doesn't. It returns { kept, dropped, reasons } — use `dropped` rather than
      // recomputing it from lengths, which would silently disagree the moment the
      // gate learns a new way to refuse something.
      const r = signals.recordSignals({
        founderId: s.founder_id, sourceId: s.id, candidates, model, createdBy: userId,
      });
      out.kept += r.kept;
      out.droppedByGate += r.dropped;
      // The gate's reasons are the most honest thing this job produces: they say
      // what the model tried to claim and couldn't back up.
      for (const reason of r.reasons || []) {
        const k = String(reason).replace(/["'].*/, '').trim().slice(0, 60);
        out.gateReasons[k] = (out.gateReasons[k] || 0) + 1;
      }
      if (r.kept > 0) out.sourcesWithSignals++;
      // Count KEPT signals by kind, not proposed — a category count that includes
      // claims the gate threw away describes a card that doesn't exist.
      for (const c of r.signals || []) out.byKind[c.kind] = (out.byKind[c.kind] || 0) + 1;
    } catch (e) {
      out.failed.push({ company: s.company, kind: s.kind, reason: e.message });
      if (e.code === 'spend_cap_exceeded') { out.stoppedOnCap = true; break; }
    }
  }
  out.estSpendUsd = Math.round(spend * 100) / 100;
  return out;
}

module.exports = { ingestWebsites, extractAll, __test: { boardCards } };
