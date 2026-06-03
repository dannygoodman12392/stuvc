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

// Self-contained archetype normalizer (mirrors talent-engine; kept local to avoid a
// circular require). Maps a role's function string to a canonical archetype.
function normalizeFn(v) {
  const s = String(v || '').toLowerCase();
  if (/customer success|customer experience|\bcsm\b|account management|account manager|post.?sales|renewals/.test(s)) return 'success';
  if (/gtm|sales|marketing|growth|revenue|cmo|cro|demand/.test(s)) return 'gtm';
  if (/product|cpo|\bpm\b/.test(s)) return 'product';
  if (/design|ux|ui|brand/.test(s)) return 'design';
  if (/ops|operation|bizops|chief of staff|coo/.test(s)) return 'operations';
  if (/finance|fp&a|cfo|account/.test(s)) return 'finance';
  if (/general|business/.test(s)) return 'generalist';
  if (/eng|technical|software|cto|developer|\bml\b|\bai\b|data/.test(s)) return 'engineering';
  return 'engineering';
}

// Infer a candidate's function from their role/headline/signals. Unknown → 'generalist'
// (which only matches generalist roles, so unknowns never flood a specialized search).
function inferCandidateFunction(c) {
  const text = [c.current_role, c.headline, c.one_liner].filter(Boolean).join(' ').toLowerCase();
  const hasStack = (parseJSON(c.tech_stack) || []).length > 0;
  if (/\b(customer success|\bcsm\b|account manager|account management|customer experience|renewals)\b/.test(text)) return 'success';
  if (/\b(sales|marketing|growth|cmo|cro|revenue|demand gen|account executive|\bae\b|\bbd\b|biz dev|gtm)\b/.test(text)) return 'gtm';
  if (/\b(product manager|head of product|cpo|group pm|\bpm\b|product lead)\b/.test(text)) return 'product';
  if (/\b(designer|design lead|head of design|ux|ui|brand)\b/.test(text)) return 'design';
  if (/\b(cfo|finance|fp&a|controller|accounting|treasur)\b/.test(text)) return 'finance';
  if (/\b(chief of staff|operations|bizops|\bcoo\b|business operations)\b/.test(text)) return 'operations';
  if (/\b(engineer|developer|software|cto|\bml\b|machine learning|\bai\b|data scientist|programmer|founding engineer|swe)\b/.test(text) || hasStack) return 'engineering';
  return 'generalist';
}

// Infer a function from free text (title or JD). Returns null when there's no signal,
// so callers can fall back. A platform partner reads "CMO" and knows it's marketing —
// the TITLE is the strongest signal, not a config field.
function inferFunctionFromText(text) {
  const s = String(text || '').toLowerCase();
  if (/\b(customer success|head of cs|vp customer success|\bcsm\b|account management|account manager|customer experience|renewals|post.?sales)\b/.test(s)) return 'success';
  if (/\b(cmo|chief marketing|vp marketing|head of marketing|marketing lead|growth|demand gen|sales|cro|chief revenue|account executive|\bae\b|gtm|go.to.market|brand|partnerships)\b/.test(s)) return 'gtm';
  if (/\b(cpo|chief product|head of product|product manager|product lead|group pm|\bpm\b)\b/.test(s)) return 'product';
  if (/\b(head of design|design lead|product designer|\bux\b|\bui\b|brand designer|creative director)\b/.test(s)) return 'design';
  if (/\b(cfo|chief financial|head of finance|vp finance|controller|fp&a|accounting)\b/.test(s)) return 'finance';
  if (/\b(coo|chief operating|chief of staff|head of operations|bizops|business operations)\b/.test(s)) return 'operations';
  if (/\b(cto|chief technology|engineer|engineering|developer|software|founding engineer|\bml\b|machine learning|data scientist|devops|\bsre\b|architect)\b/.test(s)) return 'engineering';
  if (/\b(general manager|business lead|first business hire)\b/.test(s)) return 'generalist';
  return null;
}

// The TRUE function of a role: title first, then JD, then an explicitly-chosen field,
// then the (default) field. This way a "CMO" role is GTM even if its function field
// was never set off the 'engineering' default.
function resolveRoleFunction(role) {
  return inferFunctionFromText(role.title)
    || inferFunctionFromText(role.jd_content)
    || ((role.role_function && role.role_function !== 'engineering') ? normalizeFn(role.role_function) : null)
    || normalizeFn(role.role_function);
}

// The gate: a role's function must match the candidate's. A 'generalist' ROLE matches
// anyone; a specialized role only matches candidates of that same function. This is what
// stops engineers from ever appearing under a CMO/GTM search.
function functionFits(candidate, role) {
  const roleFn = resolveRoleFunction(role);
  if (roleFn === 'generalist') return true;
  const candFn = candidate.role_function || inferCandidateFunction(candidate);
  return candFn === roleFn;
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

  // 7. Must-haves (non-negotiables) — previously loaded but ignored. Penalize when the
  // role declares must-haves and the candidate shows no evidence of them.
  const rMust = (parseJSON(role.must_haves) || []).map(s => s.toLowerCase()).filter(Boolean);
  if (rMust.length > 0) {
    const hay = [cStack.join(' '), cBuilderSignals, cPedigree,
      (candidate.headline || '').toLowerCase(), (candidate.current_role || '').toLowerCase(),
      (candidate.one_liner || '').toLowerCase()].join(' ');
    const met = rMust.filter(m => hay.includes(m));
    if (met.length === 0) { score -= 20; breakdown.mustHaves = -20; gaps.push(`Missing all must-haves: ${rMust.slice(0, 3).join(', ')}`); }
    else if (met.length < rMust.length) { score -= 8; breakdown.mustHaves = -8; gaps.push(`Missing must-have(s): ${rMust.filter(m => !met.includes(m)).slice(0, 3).join(', ')}`); }
    else { breakdown.mustHaves = 0; strengths.push('All must-haves met'); }
  }

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

      // FUNCTION GATE — never pair a candidate with a role outside their function
      // (e.g. an engineer with a CMO role). This runs before scoring.
      if (!functionFits(cand, role)) continue;

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

module.exports = { runMatchEngine, heuristicMatch, inferCandidateFunction, normalizeFn, functionFits, resolveRoleFunction, inferFunctionFromText };
