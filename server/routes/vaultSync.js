/**
 * routes/vaultSync.js — a narrow, single-purpose read channel for the local Obsidian
 * vault-sync automation. Deliberately NOT part of the shareable MCP token system: Stu's
 * MCP surface has an explicit design boundary ("no code path to founders / assessments /
 * notes / memos — those stay private to Stu's owner") because Stu is shared with portfolio
 * founders and VC friends who mint their own MCP tokens. This endpoint exists so Danny's
 * OWN local automation can read his OWN assessments to write them into his vault, without
 * ever touching that shared surface — gated by a single fixed secret only he holds
 * (VAULT_SYNC_SECRET), never exposed in any UI, never distributable via the token flow.
 *
 * Fails closed: if VAULT_SYNC_SECRET isn't set, every request 503s — no accidental exposure.
 * Owner-only (userId 1), matching the existing convention for other owner-only automation
 * (e.g. the weekly founder digest).
 */
const express = require('express');
const crypto = require('crypto');
const router = express.Router();
const db = require('../db');

const OWNER_ID = 1;

function timingSafeEqual(a, b) {
  const bufA = Buffer.from(String(a));
  const bufB = Buffer.from(String(b));
  if (bufA.length !== bufB.length) return false;
  return crypto.timingSafeEqual(bufA, bufB);
}

function requireVaultSyncSecret(req, res, next) {
  const secret = process.env.VAULT_SYNC_SECRET;
  if (!secret) return res.status(503).json({ error: 'Vault sync is not configured (VAULT_SYNC_SECRET unset).' });
  const h = req.headers.authorization || '';
  const provided = h.startsWith('Bearer ') ? h.slice(7).trim() : (req.headers['x-vault-sync-secret'] || '');
  if (!provided || !timingSafeEqual(provided, secret)) {
    return res.status(401).json({ error: 'Invalid or missing vault-sync credential.' });
  }
  next();
}

router.use(requireVaultSyncSecret);

function safeParse(raw) {
  try { return typeof raw === 'string' ? JSON.parse(raw) : raw; } catch { return null; }
}

// Pure, unit-testable: the exact agent-output column mapping the app itself uses (see
// server/routes/assessments.js:957-961). Extracted here so the mapping is covered by a test
// that fails loudly if it ever drifts from the app's own read path — this is a real landmine
// (columns literally named after agents that no longer write to them).
function mapAgentOutputs(row) {
  return {
    team: safeParse(row.founder_agent_output),
    product: safeParse(row.market_agent_output),
    market: safeParse(row.economics_agent_output),
    bear: safeParse(row.bear_agent_output),
  };
}

// Real Founder Assessments only. Meeting Prep (assessment_type='meeting_prep') has a
// completely different data shape (founder_profile/company_snapshot/thesis_fit/... — see
// agents/prompts.js meetingPrep) and would crash or garble the vault template if this
// bridge tried to map it through mapAgentOutputs/synthesis like a real assessment. Meeting
// Prep gets its own vault-sync path later if/when Danny wants briefings synced too.
const ASSESSMENT_TYPE_FILTER = "(a.assessment_type IS NULL OR a.assessment_type = 'assessment')";

// GET /api/vault-sync/assessments — a light list for the local task to dedupe against.
router.get('/assessments', (req, res) => {
  const rows = db.prepare(`
    SELECT a.id, a.founder_id, a.group_id, a.version_number, a.status, a.overall_signal,
           a.conviction_score, a.conviction_band, a.evidence_rung, a.created_at,
           f.name as founder_name, f.company as founder_company
    FROM opportunity_assessments a
    LEFT JOIN founders f ON a.founder_id = f.id
    WHERE a.is_deleted = 0 AND a.created_by = ? AND ${ASSESSMENT_TYPE_FILTER}
    ORDER BY a.created_at DESC
    LIMIT 200
  `).all(OWNER_ID);
  res.json(rows);
});

// GET /api/vault-sync/assessments/:id — full detail: correctly-mapped agent outputs (the
// DB columns were repurposed from an earlier 6-agent schema and no longer match their own
// names — economics_agent_output actually holds Market, market_agent_output holds Product;
// this mirrors the exact mapping the app itself uses at server/routes/assessments.js:957-961)
// + synthesis + the latest rubric run + the raw inputs (for Call Notes).
router.get('/assessments/:id', (req, res) => {
  const a = db.prepare(`
    SELECT a.*, f.name as founder_name, f.company as founder_company
    FROM opportunity_assessments a
    LEFT JOIN founders f ON a.founder_id = f.id
    WHERE a.id = ? AND a.is_deleted = 0 AND a.created_by = ? AND ${ASSESSMENT_TYPE_FILTER}
  `).get(req.params.id, OWNER_ID);
  if (!a) return res.status(404).json({ error: 'Assessment not found (or is a Meeting Prep — not synced by this endpoint).' });

  const agents = mapAgentOutputs(a);
  const synthesis = safeParse(a.synthesis_output);
  // The Founder Rubric now runs inline on every assessment and IS the conviction score.
  // This used to read `steward_operator_evaluations` — the ARCHIVED 9-trait rubric,
  // retired 2026-06-25 — and export it to the vault under the key `rubric`. Anything
  // reading the vault was getting the retired framework labelled as the current one.
  const rubric = safeParse(a.rubric_output);
  const legacyStewardOperator = db.prepare(
    'SELECT output, overall_score, threshold, flagged, status FROM steward_operator_evaluations WHERE assessment_id = ? ORDER BY id DESC LIMIT 1'
  ).get(a.id);
  const inputs = db.prepare(
    'SELECT input_type, label, content, source_url, file_name, created_at FROM assessment_inputs WHERE assessment_id = ? ORDER BY input_type, created_at'
  ).all(a.id);

  res.json({
    id: a.id, founder_id: a.founder_id, founder_name: a.founder_name, founder_company: a.founder_company,
    status: a.status, overall_signal: a.overall_signal, created_at: a.created_at,
    group_id: a.group_id, version_number: a.version_number,
    // The verdict, and — just as important — how much it is worth trusting. Without the
    // rung and band, "Insufficient evidence" is just a string that reads like a rejection.
    conviction: safeParse(a.conviction_output),
    conviction_score: a.conviction_score,
    conviction_band: a.conviction_band,
    evidence_rung: a.evidence_rung,
    evidence: safeParse(a.evidence_output),
    context_notes: safeParse(a.context_notes),
    agents, synthesis,
    rubric, // Founder Rubric — the four movements that decided the score
    legacy_steward_operator: legacyStewardOperator
      ? { ...legacyStewardOperator, output: safeParse(legacyStewardOperator.output), note: 'ARCHIVED 9-trait rubric, retired 2026-06-25. Historical rows only.' }
      : null,
    inputs,
  });
});

module.exports = router;
module.exports.timingSafeEqual = timingSafeEqual;
module.exports.mapAgentOutputs = mapAgentOutputs;
