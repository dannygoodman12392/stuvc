// ══════════════════════════════════════════════════════════════════════════
// signals.js — the honesty gate.
//
// Danny, 2026-07-16: "I want to get incredibly insightful, accurate signals
// about founder and company performance to the best of your ability, no
// hallucinations and 100% honest."
//
// ── WHY THIS IS CODE AND NOT A PROMPT ──
// You cannot instruct a model into honesty and then trust the result. Every
// "be accurate, don't make things up" prompt in this repo is still one sampling
// away from a confident fabrication, and the reader has no way to tell. This
// codebase has the scar: a MANDATORY SCORING RULE once forced product 8s off a
// slide claim, and those 8s tripped a ceiling that muzzled the Bear — a deck
// could talk itself into an Invest and silence the one agent built to catch it.
//
// So honesty here is mechanical:
//
//   1. A signal cannot exist without a source. (source_id NOT NULL)
//   2. A signal cannot exist without the verbatim line that proves it.
//      (quote NOT NULL — the same rule commitments enforce, for the same reason:
//      a paraphrase of a fact is exactly the thing that can be invented.)
//   3. Every quote is checked against that source's text, deterministically,
//      by agents/verify.js — bigram adjacency, no second LLM call, nothing to
//      sample.
//   4. `unverified` is DROPPED. Not badged, not amber, not "low confidence."
//      Dropped.
//   5. A claim asserting a number the source doesn't contain is dropped, whatever
//      its quote says. An invented "$60K ARR" reads as a fact and there is no
//      other way for Danny to catch it.
//
// ── WHY DROP RATHER THAN BADGE ──
// verify.js was built for assessments, where a human reads a page of evidence and
// a tag helps them weigh it. Its header says so: "Verification NEVER changes a
// score. It only annotates." That's right there and wrong here. A card signal is
// GLANCED at, between meetings, and NN/G's finding applies: a badge nobody reads
// is a badge that isn't there. An amber "≈ unverified" next to a fabricated
// number is worse than no signal at all, because the row's existence is itself
// the claim.
//
// The cost is real: we will drop true signals whose quote got reworded. That's
// the trade this file makes deliberately — a missed signal costs one row, a
// fabricated one costs the card.
// ══════════════════════════════════════════════════════════════════════════

const crypto = require('crypto');
const db = require('../db');
const { classifyQuote, buildContextIndex, unsupportedNumbers } = require('../agents/verify');

const KINDS = ['traction', 'team', 'product', 'market', 'risk', 'raise', 'customer'];
const SOURCE_KINDS = ['deck', 'url', 'linkedin', 'granola', 'note', 'filing'];

const hash = (s) => crypto.createHash('sha256').update(String(s || '')).digest('hex').slice(0, 32);

/**
 * Record a source — one artifact Danny fed the card.
 *
 * Idempotent on TWO keys, because an artifact has two kinds of identity and
 * content_hash alone only catches one of them:
 *
 *   1. `uri`  — a stable EXTERNAL id. A Granola meeting is `granola:<uuid>`; a web
 *      read is the URL. This is the artifact's real identity: the call happened
 *      once, whatever its transcript says today.
 *   2. `content_hash` — for artifacts with no external id (a pasted note, a deck).
 *
 * ── WHY uri HAD TO BE ADDED ──
 * content_hash alone assumes the same artifact always yields byte-identical text.
 * It doesn't. Caught on production 2026-07-16: ONE Cadrian call landed TWICE —
 *
 *   id=106 uri=granola:ba38465a-… signals=11
 *   id=107 uri=granola:ba38465a-… signals=10
 *
 * — same meeting, same Granola id, two rows, because the two pushes carried
 * slightly different transcript text. The card then reported 21 facts from a
 * single conversation: the same claims, counted twice, each with a real verbatim
 * quote. Every receipt checks out and the total is a lie.
 *
 * This was going to happen nightly without the fix. Granola re-processes
 * transcripts (speaker labels, corrections), so the text for a given meeting is
 * not stable over time — and the nightly task re-pushes a 30-day window on every
 * run. The docstring above this function already warned that duplicates are how
 * "he stops trusting it by Thursday". It was describing the bug it had.
 *
 * Re-pushing a known uri returns the existing row and does NOT overwrite its text.
 * Deliberate: the stored transcript is what the card's existing signals were
 * verified against, and silently swapping it under them would leave quotes
 * pointing at text that no longer contains them.
 */
function recordSource({ founderId, kind, title, uri, contentText, meta, occurredAt, addedBy }) {
  if (!SOURCE_KINDS.includes(kind)) throw new Error(`source kind must be one of ${SOURCE_KINDS.join('|')}`);
  if (!founderId) throw new Error('a source must belong to a company');

  if (uri) {
    const byUri = db.prepare('SELECT id FROM company_sources WHERE founder_id = ? AND uri = ?')
      .get(founderId, uri);
    if (byUri) return { id: byUri.id, created: false };
  }

  const h = hash(contentText || uri || title);
  const existing = db.prepare('SELECT id FROM company_sources WHERE founder_id = ? AND content_hash = ?')
    .get(founderId, h);
  if (existing) return { id: existing.id, created: false };

  const r = db.prepare(`
    INSERT INTO company_sources (founder_id, kind, title, uri, content_text, content_hash, meta, occurred_at, added_by)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    founderId, kind, title || null, uri || null, contentText || null, h,
    meta ? JSON.stringify(meta) : null, occurredAt || null, addedBy || null
  );
  return { id: r.lastInsertRowid, created: true };
}

/**
 * The gate. Takes candidate signals from an extractor and writes ONLY those whose
 * quote survives verification against the source's own text.
 *
 * @returns { kept, dropped, reasons } — the drop count is REPORTED, never silent.
 *   Danny has to be able to see "the extractor proposed 9 and 6 survived",
 *   because a gate you can't see is indistinguishable from an extractor that
 *   found nothing, and he'd rightly conclude the feature was broken.
 */
function recordSignals({ founderId, sourceId, candidates, model, createdBy }) {
  const source = db.prepare('SELECT * FROM company_sources WHERE id = ? AND founder_id = ?')
    .get(sourceId, founderId);
  if (!source) throw new Error('no such source for this company');

  // No text, no signals. A source we couldn't read (a scanned deck, a 403'd URL)
  // must produce NOTHING rather than let a model narrate from the filename.
  if (!source.content_text || source.content_text.length < 40) {
    return { kept: 0, dropped: (candidates || []).length, reasons: ['source has no readable text'], signals: [] };
  }

  const index = buildContextIndex(source.content_text);
  const kept = [];
  const reasons = [];

  const insert = db.prepare(`
    INSERT INTO company_signals (founder_id, source_id, kind, claim, quote, verification, model, created_by)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `);

  const tx = db.transaction((rows) => {
    for (const c of rows) {
      if (!c || !c.claim || !c.quote) {
        reasons.push(`dropped: no ${!c?.claim ? 'claim' : 'quote'}`);
        continue;
      }
      if (!KINDS.includes(c.kind)) {
        reasons.push(`dropped "${String(c.claim).slice(0, 40)}": unknown kind ${c.kind}`);
        continue;
      }

      // (1) Does the quote actually appear in the source?
      const verdict = classifyQuote(c.quote, index);
      if (verdict === 'unverified') {
        reasons.push(`dropped "${String(c.claim).slice(0, 48)}": quote not found in ${source.kind}`);
        continue;
      }

      // (2) Does the CLAIM's arithmetic live in ITS OWN QUOTE — not merely
      // somewhere in the source?
      //
      // This was checked against the whole source and that was too loose. Caught
      // live on 2026-07-16, reading permute.ai:
      //
      //   claim: "...observed across more than 100 companies"
      //   quote: "Leadership is flying blind and can't adopt AI at scale"
      //
      // Both halves passed. The quote is verbatim; "100" does appear on the page —
      // just nowhere near that sentence. So the row rendered a sourced-looking
      // number whose receipt proves nothing, which is the precise laundering shape
      // this file exists to stop, one level subtler than the one it already caught.
      //
      // The rule is now: a claim's numbers must appear in the line offered as
      // proof of it. A receipt has to be a receipt FOR the thing.
      const quoteIndex = buildContextIndex(c.quote);
      const invented = unsupportedNumbers(c.claim, quoteIndex);
      if (invented.length) {
        reasons.push(
          `dropped "${String(c.claim).slice(0, 44)}": the quote doesn't carry ${invented.join(', ')}`
        );
        continue;
      }

      const r = insert.run(founderId, sourceId, c.kind, c.claim, c.quote, verdict, model || null, createdBy || null);
      kept.push({ id: r.lastInsertRowid, ...c, verification: verdict });
    }
  });
  tx(candidates || []);

  return {
    kept: kept.length,
    dropped: (candidates || []).length - kept.length,
    reasons,
    signals: kept,
  };
}

/** Everything known about a company, with its receipts. */
function signalsFor(founderId) {
  return db.prepare(`
    SELECT s.*, src.kind AS source_kind, src.title AS source_title, src.uri AS source_uri,
           src.occurred_at AS source_occurred_at
    FROM company_signals s
    JOIN company_sources src ON s.source_id = src.id
    WHERE s.founder_id = ?
    ORDER BY s.kind, s.extracted_at DESC
  `).all(founderId);
}

function sourcesFor(founderId) {
  return db.prepare(`
    SELECT id, kind, title, uri, occurred_at, created_at, meta,
           LENGTH(content_text) AS chars,
           (SELECT COUNT(*) FROM company_signals g WHERE g.source_id = company_sources.id) AS signal_count
    FROM company_sources WHERE founder_id = ?
    ORDER BY COALESCE(occurred_at, created_at) DESC
  `).all(founderId);
}

/**
 * Delete a source and everything it produced. A claim must never outlive its
 * evidence — if Danny removes the deck, the deck's signals go with it. The
 * alternative is orphaned claims with a dangling source_id, which is exactly the
 * "where did this come from?" state this whole file exists to prevent.
 */
function deleteSource(founderId, sourceId) {
  const tx = db.transaction(() => {
    db.prepare('DELETE FROM company_signals WHERE source_id = ? AND founder_id = ?').run(sourceId, founderId);
    db.prepare('DELETE FROM company_sources WHERE id = ? AND founder_id = ?').run(sourceId, founderId);
  });
  tx();
}

module.exports = { recordSource, recordSignals, signalsFor, sourcesFor, deleteSource, KINDS, SOURCE_KINDS, hash };
