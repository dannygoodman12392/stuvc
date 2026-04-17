/**
 * R5 — Co-founder pair detector
 * =============================
 * Post-processing job that scans `sourced_founders` for candidates sharing a
 * previous employer AND landing in the queue within a 90-day window.
 *
 * Heuristic: two senior ICs leaving the same top company within weeks is one of
 * the highest-precision pre-seed signals there is. When we detect the pattern,
 * bump confidence_score by +1 (capped at 10) and tag the row.
 *
 * Runs at end of each sourcing run. Idempotent — only re-tags rows whose
 * current `pair_candidate_ids` does not already include the detected peers.
 */

const db = require('../db');

// Normalize a "previous company" claim out of pedigree_signals and headline/text.
// Pedigree signals look like ["Ex-Stripe", "Kellogg MBA", "Ex-Google"].
// Returns an array of normalized company names (lowercased, no "Ex-" prefix).
function extractPrevCompanies(row) {
  const out = new Set();
  try {
    const peds = JSON.parse(row.pedigree_signals || '[]');
    for (const p of peds) {
      const m = /^ex-([a-z0-9 &.-]+)/i.exec(p);
      if (m) out.add(m[1].trim().toLowerCase());
    }
  } catch {}
  // Also pull from raw_data headline
  try {
    const raw = JSON.parse(row.raw_data || '{}');
    const combined = ((raw.headline || '') + ' ' + (raw.text || '')).toLowerCase();
    const patterns = [
      /\bex-([a-z][a-z0-9&.-]{1,20})\b/gi,
      /\bformerly\s+([a-z][a-z0-9&.-]{1,20})\b/gi,
      /\bpreviously\s+(at\s+)?([a-z][a-z0-9&.-]{1,20})\b/gi,
    ];
    for (const p of patterns) {
      let m;
      while ((m = p.exec(combined)) !== null) {
        const co = (m[2] || m[1]).trim();
        if (co.length > 2 && co.length < 20) out.add(co);
      }
    }
  } catch {}
  return Array.from(out);
}

// Run pair detection for a given user. Returns { pairsFound, rowsBumped }.
function detectPairs({ userId, windowDays = 90 }) {
  const rows = db.prepare(`
    SELECT id, name, company, pedigree_signals, raw_data, confidence_score, pair_candidate_ids, created_at, previous_company_norm
    FROM sourced_founders
    WHERE user_id = ? AND status IN ('pending', 'starred')
      AND created_at >= DATE('now', '-' || ? || ' days')
  `).all(userId, windowDays);

  if (rows.length < 2) return { pairsFound: 0, rowsBumped: 0 };

  // Build co -> [row] index
  const byCo = new Map();
  for (const r of rows) {
    const cos = r.previous_company_norm
      ? JSON.parse(r.previous_company_norm)
      : extractPrevCompanies(r);
    // Persist normalized prev-co back
    if (!r.previous_company_norm) {
      db.prepare('UPDATE sourced_founders SET previous_company_norm = ? WHERE id = ?').run(JSON.stringify(cos), r.id);
    }
    for (const co of cos) {
      if (!byCo.has(co)) byCo.set(co, []);
      byCo.get(co).push(r);
    }
  }

  // Find groups of 2+ sharing a prev-co within the window
  const pairsFound = [];
  for (const [co, group] of byCo.entries()) {
    if (group.length < 2) continue;
    // Must be distinct people (skip same-name dedup edge cases)
    const distinct = [...new Map(group.map(g => [g.name.toLowerCase(), g])).values()];
    if (distinct.length < 2) continue;
    // Check temporal cluster: any two within windowDays
    const sorted = distinct.slice().sort((a, b) => new Date(a.created_at) - new Date(b.created_at));
    const first = new Date(sorted[0].created_at);
    const last = new Date(sorted[sorted.length - 1].created_at);
    const spanDays = (last - first) / (1000 * 60 * 60 * 24);
    if (spanDays <= windowDays) {
      pairsFound.push({ company: co, members: distinct });
    }
  }

  // Apply bump + tag
  let rowsBumped = 0;
  const updateStmt = db.prepare(`
    UPDATE sourced_founders
    SET pair_candidate_ids = ?,
        confidence_score = MIN(10, confidence_score + 1),
        builder_signals = ?
    WHERE id = ? AND (pair_candidate_ids IS NULL OR pair_candidate_ids = '' OR pair_candidate_ids = '[]')
  `);
  for (const pair of pairsFound) {
    const ids = pair.members.map(m => m.id);
    for (const m of pair.members) {
      const peerIds = ids.filter(x => x !== m.id);
      let bs = [];
      try { bs = JSON.parse(m.builder_signals || '[]'); } catch {}
      if (!bs.some(s => /co-founder pair/i.test(s))) {
        bs.push(`Co-founder Pair Candidate (ex-${pair.company})`);
      }
      const result = updateStmt.run(JSON.stringify(peerIds), JSON.stringify(bs), m.id);
      if (result.changes > 0) rowsBumped++;
    }
  }

  return { pairsFound: pairsFound.length, rowsBumped };
}

module.exports = { detectPairs, extractPrevCompanies };
