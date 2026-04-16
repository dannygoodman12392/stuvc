/**
 * Superior Studios — Match Engine
 * =================================
 * Scores candidate ↔ role fit. Two modes:
 *   - Deterministic (default): fast heuristic based on stack / band / location / score
 *   - AI (optional): Claude-scored with rich rationale for top pairs
 *
 * Persists rows in talent_matches. Idempotent per (candidate, role) pair.
 */

const db = require('../db');

function parseJSON(s, fallback = []) {
  if (!s) return fallback;
  try { return JSON.parse(s); } catch { return fallback; }
}

// Heuristic scoring — fast, deterministic, explainable
function heuristicMatch(candidate, role) {
  const cStack = (parseJSON(candidate.tech_stack) || []).map(s => s.toLowerCase());
  const rStack = (parseJSON(role.stack_requirements) || []).map(s => s.toLowerCase());
  const cBands = parseJSON(candidate.band_fit) || [];
  const rBand = role.band || null;
  const rDomains = (parseJSON(role.domain_requirements) || []).map(s => s.toLowerCase());
  const cBuilderSignals = (parseJSON(candidate.builder_signals) || []).map(s => s.toLowerCase()).join(' ');
  const cPedigree = (parseJSON(candidate.pedigree_signals) || []).map(s => s.toLowerCase()).join(' ');

  const strengths = [];
  const gaps = [];
  let score = 0;
  const breakdown = {};

  // 1. Band fit (25 pts)
  if (rBand && cBands.includes(rBand)) {
    score += 25;
    strengths.push(`Band ${rBand} fit`);
    breakdown.band = 25;
  } else if (rBand && cBands.length > 0) {
    gaps.push(`Not ideal for band ${rBand} (fits ${cBands.join(', ')})`);
    breakdown.band = 10;
    score += 10;
  } else {
    breakdown.band = 15;
    score += 15;
  }

  // 2. Stack overlap (25 pts, based on % overlap)
  if (rStack.length > 0) {
    const overlap = rStack.filter(s => cStack.some(c => c.includes(s) || s.includes(c)));
    const pct = overlap.length / rStack.length;
    const stackPts = Math.round(pct * 25);
    score += stackPts;
    breakdown.stack = stackPts;
    if (overlap.length > 0) strengths.push(`Stack: ${overlap.join(', ')}`);
    if (pct < 0.5) gaps.push(`Missing stack: ${rStack.filter(s => !overlap.includes(s)).slice(0, 3).join(', ')}`);
  } else {
    score += 15;
    breakdown.stack = 15;
  }

  // 3. Overall candidate caliber (20 pts)
  const overall = candidate.overall_score || 5;
  const caliberPts = Math.round((overall / 10) * 20);
  score += caliberPts;
  breakdown.caliber = caliberPts;
  if (overall >= 8) strengths.push(`High caliber (${overall}/10)`);
  else if (overall < 6) gaps.push(`Lower overall score (${overall}/10)`);

  // 4. Leap readiness (15 pts)
  const leap = candidate.score_leap_readiness || 5;
  const leapPts = Math.round((leap / 10) * 15);
  score += leapPts;
  breakdown.leap = leapPts;
  if (leap >= 7) strengths.push(`Leap-ready (${leap}/10)`);
  else if (leap < 5) gaps.push('Likely locked in at current role');

  // 5. Domain fit (10 pts)
  if (rDomains.length > 0) {
    const matched = rDomains.filter(d => cBuilderSignals.includes(d) || cPedigree.includes(d));
    if (matched.length > 0) {
      score += 10;
      breakdown.domain = 10;
      strengths.push(`Domain: ${matched.join(', ')}`);
    } else {
      score += 3;
      breakdown.domain = 3;
      gaps.push(`No visible ${rDomains.slice(0, 2).join('/')} background`);
    }
  } else {
    score += 7;
    breakdown.domain = 7;
  }

  // 6. Location (5 pts)
  const loc = (candidate.location_city || '').toLowerCase();
  const rLoc = (role.location_pref || '').toLowerCase();
  if (role.remote_ok) { score += 5; breakdown.location = 5; }
  else if (rLoc && loc.includes(rLoc)) { score += 5; breakdown.location = 5; strengths.push(`Located in ${candidate.location_city}`); }
  else if (rLoc) { score += 1; breakdown.location = 1; gaps.push(`Not in ${role.location_pref}`); }
  else { score += 4; breakdown.location = 4; }

  const rationale = [
    strengths.length > 0 ? `Strengths: ${strengths.join('; ')}.` : '',
    gaps.length > 0 ? `Gaps: ${gaps.join('; ')}.` : '',
  ].filter(Boolean).join(' ');

  return {
    match_score: Math.min(100, Math.max(0, score)),
    match_rationale: rationale || 'Heuristic match',
    strengths,
    gaps,
    breakdown,
  };
}

async function runMatchEngine({ userId = 1, roleId = null, candidateId = null, onlyNewCandidates = false, minScore = 50 } = {}) {
  console.log(`[MatchEngine] Start (user ${userId}, role=${roleId}, candidate=${candidateId}, minScore=${minScore})`);

  // Load relevant roles
  let roles;
  if (roleId) {
    roles = db.prepare("SELECT * FROM talent_roles WHERE id = ? AND user_id = ? AND is_deleted = 0 AND status = 'open'").all(roleId, userId);
  } else {
    roles = db.prepare("SELECT * FROM talent_roles WHERE user_id = ? AND is_deleted = 0 AND status = 'open'").all(userId);
  }

  if (roles.length === 0) {
    console.log('[MatchEngine] No open roles — nothing to match');
    return { matches_created: 0, matches_updated: 0, pairs_evaluated: 0 };
  }

  // Load relevant candidates
  let candQuery = 'SELECT * FROM talent_candidates WHERE user_id = ? AND is_deleted = 0';
  const candParams = [userId];
  if (candidateId) {
    candQuery += ' AND id = ?';
    candParams.push(candidateId);
  } else if (onlyNewCandidates) {
    candQuery += ' AND created_at > datetime("now", "-1 day")';
  }
  const candidates = db.prepare(candQuery).all(...candParams);

  console.log(`[MatchEngine] Evaluating ${candidates.length} candidates × ${roles.length} roles`);

  const upsertMatch = db.prepare(`
    INSERT INTO talent_matches (user_id, candidate_id, role_id, match_score, match_rationale, strengths, gaps, status)
    VALUES (?, ?, ?, ?, ?, ?, ?, 'suggested')
    ON CONFLICT(candidate_id, role_id) DO UPDATE SET
      match_score = excluded.match_score,
      match_rationale = excluded.match_rationale,
      strengths = excluded.strengths,
      gaps = excluded.gaps,
      updated_at = CURRENT_TIMESTAMP
  `);

  let created = 0;
  let evaluated = 0;

  for (const cand of candidates) {
    for (const role of roles) {
      evaluated++;
      const { match_score, match_rationale, strengths, gaps } = heuristicMatch(cand, role);

      // Only persist matches above threshold (avoid noise)
      if (match_score < minScore) continue;

      const existing = db.prepare('SELECT id, is_deleted FROM talent_matches WHERE candidate_id = ? AND role_id = ?').get(cand.id, role.id);
      if (existing && existing.is_deleted) continue; // don't resurrect user-deleted matches

      upsertMatch.run(
        userId, cand.id, role.id,
        match_score, match_rationale,
        JSON.stringify(strengths), JSON.stringify(gaps)
      );
      created++;
    }
  }

  console.log(`[MatchEngine] ✅ ${evaluated} pairs → ${created} matches created/updated`);
  return { matches_created: created, pairs_evaluated: evaluated };
}

module.exports = { runMatchEngine, heuristicMatch };
