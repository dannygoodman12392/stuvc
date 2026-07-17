'use strict';
// ══════════════════════════════════════════════════════════════════════════
// snapshots.js — keep the readings, so "how are they doing" becomes answerable.
//
// Danny, day one: "get a real sense for what the company is, how it's doing."
//
// "How it's doing" is a derivative and needs two readings. Stu kept one:
// `company_enrichment` is a single blob and every refetch overwrote it. This is
// the append-only half — the writers below still update that blob (the card reads
// it, and it should hold the newest thing), but nothing is destroyed any more.
//
// See the long note in db.js for why this is the one asset that can't be bought:
// three independent research lines on 2026-07-16 all landed on "you cannot
// backfill history; instrument forward."
// ══════════════════════════════════════════════════════════════════════════

const crypto = require('crypto');
const db = require('../db');

const SOURCES = ['enrichlayer', 'public_record'];

function hash(s) {
  return crypto.createHash('sha256').update(String(s || '')).digest('hex');
}

// ── What's worth pulling out of the blob ──
// Only the scalars a time series is actually built from. Everything else stays in
// the blob — the shape belongs to the provider, and a provider that adds a field
// shouldn't need a migration.
function scalarsFor(source, blob) {
  if (!blob || typeof blob !== 'object') return {};
  if (source === 'enrichlayer') {
    return {
      // verified_count, not size_on_linkedin: the former is people whose own
      // profile names this employer, the latter is what the company page claims.
      // Both are "true" and they measure different things; the series should track
      // the one that can't be self-reported.
      headcount: Number.isFinite(blob.verified_count) ? blob.verified_count : null,
      role_count: null,
      amount_sold: null,
    };
  }
  if (source === 'public_record') {
    return {
      headcount: null,
      role_count: blob.hiring?.found ? (blob.hiring.role_count ?? null) : null,
      amount_sold: blob.funding?.found ? (blob.funding.latest?.amount_sold ?? null) : null,
    };
  }
  return {};
}

// The blob carries a fetch timestamp that changes on every read even when nothing
// else did. Hashing it would make every refetch look like news and the series
// would be pure noise — a row a night saying "still 6 people".
const VOLATILE = new Set(['fetched_at']);

function stableHash(blob) {
  const strip = (v) => {
    if (Array.isArray(v)) return v.map(strip);
    if (v && typeof v === 'object') {
      const out = {};
      for (const k of Object.keys(v).sort()) {
        if (VOLATILE.has(k)) continue;
        out[k] = strip(v[k]);
      }
      return out;
    }
    return v;
  };
  return hash(JSON.stringify(strip(blob)));
}

/**
 * Record a reading. Appends only when it DIFFERS from the previous reading of the
 * same source for the same company.
 *
 * Deduped against the LATEST row only, never against all history: headcount
 * 6 → 7 → 6 is a real sequence, and a UNIQUE(content_hash) would reject the third
 * reading and erase the fact that they shrank back.
 *
 * @returns {{created:boolean, id?:number, reason?:string}}
 */
function recordSnapshot({ founderId, source, blob }) {
  if (!founderId) throw new Error('a snapshot must belong to a company');
  if (!SOURCES.includes(source)) throw new Error(`source must be one of ${SOURCES.join('|')}`);
  if (!blob) return { created: false, reason: 'nothing to record' };

  const h = stableHash(blob);
  const prev = db.prepare(
    'SELECT id, content_hash FROM company_snapshots WHERE founder_id = ? AND source = ? ORDER BY taken_at DESC, id DESC LIMIT 1'
  ).get(founderId, source);

  if (prev && prev.content_hash === h) return { created: false, reason: 'unchanged since last reading' };

  const s = scalarsFor(source, blob);
  const r = db.prepare(`
    INSERT INTO company_snapshots (founder_id, source, headcount, role_count, amount_sold, blob, content_hash)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `).run(founderId, source, s.headcount ?? null, s.role_count ?? null, s.amount_sold ?? null, JSON.stringify(blob), h);

  return { created: true, id: r.lastInsertRowid };
}

/** Every reading for a company, oldest first — the series. */
function snapshotsFor(founderId, source) {
  const sql = source
    ? 'SELECT id, taken_at, source, headcount, role_count, amount_sold FROM company_snapshots WHERE founder_id = ? AND source = ? ORDER BY taken_at ASC, id ASC'
    : 'SELECT id, taken_at, source, headcount, role_count, amount_sold FROM company_snapshots WHERE founder_id = ? ORDER BY taken_at ASC, id ASC';
  return source ? db.prepare(sql).all(founderId, source) : db.prepare(sql).all(founderId);
}

/**
 * The answer to "how are they doing" — but only when it's earned.
 *
 * Returns null with a reason until there are two readings that differ. A single
 * reading is a fact, not a trend, and rendering "+0 since we met" off one data
 * point would be a claim about time we haven't observed.
 */
function deltaFor(founderId, source = 'enrichlayer', field = 'headcount') {
  const rows = snapshotsFor(founderId, source).filter((r) => r[field] != null);
  if (rows.length < 2) {
    return { has: false, reason: rows.length ? 'only one reading so far — a trend needs two' : 'never read' };
  }
  const first = rows[0];
  const last = rows[rows.length - 1];
  const days = Math.round((new Date(last.taken_at) - new Date(first.taken_at)) / 86400000);
  return {
    has: true,
    from: first[field],
    to: last[field],
    delta: last[field] - first[field],
    days,
    since: first.taken_at,
    readings: rows.length,
  };
}

/**
 * Seed the series from the blobs already sitting on `founders`.
 *
 * One-time, and it is the whole reason this shipped tonight. 44 companies were
 * enriched on 2026-07-16 and 68 web-read, and every one of those readings existed
 * ONLY in the overwrite-on-refetch column. Without this, the first reading of the
 * series would be whenever the next fetch happened — and the next fetch is exactly
 * the event that would have destroyed today's.
 *
 * The taken_at is backdated to the column's own fetch timestamp, not now: these
 * readings were taken today, and stamping them with the migration time would put a
 * false date on the first point of every series. A series that lies about when it
 * started is worse than no series.
 *
 * Idempotent — recordSnapshot dedupes on content, so re-running is free.
 */
function seedFromExisting({ userId = 1 } = {}) {
  const out = { enrichlayer: 0, public_record: 0, skipped: 0 };

  const rows = db.prepare(`
    SELECT id, company_enrichment, company_enriched_at, company_public, company_public_at
      FROM founders
     WHERE created_by = ? AND is_deleted = 0
       AND (company_enrichment IS NOT NULL OR company_public IS NOT NULL)
  `).all(userId);

  for (const r of rows) {
    for (const [col, at, source] of [
      ['company_enrichment', r.company_enriched_at, 'enrichlayer'],
      ['company_public', r.company_public_at, 'public_record'],
    ]) {
      if (!r[col]) continue;
      let blob;
      try { blob = JSON.parse(r[col]); } catch { out.skipped++; continue; }
      const res = recordSnapshot({ founderId: r.id, source, blob });
      if (!res.created) continue;
      // Backdate to when the reading was actually taken.
      const when = blob?.fetched_at || at;
      if (when) db.prepare('UPDATE company_snapshots SET taken_at = ? WHERE id = ?').run(when, res.id);
      out[source]++;
    }
  }
  return out;
}

module.exports = { recordSnapshot, snapshotsFor, deltaFor, stableHash, seedFromExisting, SOURCES };
