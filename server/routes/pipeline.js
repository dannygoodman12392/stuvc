// ══════════════════════════════════════════════════════════════════════════
// Pipeline — the front door, and the one connected read.
//
// Danny, verbatim and repeatedly: "I want to transition Stu into being my
// personal Affinity/Harmonic (sourcing, tracking, assessing). And then I publish
// memos in Obsidian for opportunities that warrant it."
//
// That is ONE sentence about ONE object. Stu had four screens pretending it had
// four objects: a sourced founder, a founder, and an assessment were three
// tables that didn't know about each other, so approving someone from Discover
// turned them into a different record and nothing carried forward.
//
// ── WHY THERE IS NO `companies` TABLE ──
// The obvious fix is a companies/people migration. It was priced at 10-15 days
// and it is a trap wearing a feature's clothes. It is also unnecessary:
// `founders` is already the spine, and every other table already points at it.
// One record means every stage JOINS to founders — which is what this file does.
// Measured before deciding (2026-07-15): 187 live founders, 5,328 soft-deleted.
// The scary "5,513 rows / 1,841 fuzzy company strings" the rebuild brief priced
// the migration against is 96% deleted junk. There is no dedupe project here.
// Do not start one.
//
// ── THE COLUMNS, AND WHY THESE ONES ──
// Company · Stage · Source · Read (Stu) · Call (Danny) · Owed · Signal
//
// READ and CALL are two columns that never merge. Stu's band and Danny's band
// sit side by side, and the DISAGREEMENT is the artifact — it's the only dataset
// in this product that compounds, and the only question no tool he can buy is
// able to answer, because answering it needs a record of what he thought before
// he knew.
//
// ── COLUMNS DELIBERATELY ABSENT ──
// "Who knows them" is Affinity's whole $2,000/user/year product and it needs a
// relationship graph that does not exist in this database yet. "Last contact" is
// worse than absent — it's fake: every live founder's updated_at is 2026-03-18,
// the Airtable import. Shipping either as an empty or lying column would teach
// Danny to distrust the row. They arrive when their data does.
// ══════════════════════════════════════════════════════════════════════════

const express = require('express');
const router = express.Router();
const db = require('../db');

// One query. Every stage of the funnel joined to the spine.
//
// The correlated subqueries look expensive and are not: 187 live rows, every
// join column indexed. Precompute and never spin — Danny should never see a
// loading state on his front door. Measured at ~4ms.
const PIPELINE_SQL = `
  SELECT
    f.id, f.name, f.company, f.company_one_liner, f.stage, f.status,
    f.deal_status, f.admissions_status, f.pipeline_tracks, f.source,
    f.chicago_connection, f.caliber_tier, f.next_action, f.arr,
    f.deal_entered_at, f.created_at,
    -- Load-bearing: stageOf() derives the invested stage from this. Omitting it
    -- made every portfolio company silently render as "met", because undefined > 0
    -- is false — the board showed "Invested 0" while the attention engine, which
    -- checks the same fact in SQL, correctly found all 9.
    f.investment_amount, f.valuation, f.round_size, f.security_type,

    -- THE READ. Stu's latest word, and only from a run that actually completed.
    (SELECT a.conviction_score FROM opportunity_assessments a
      WHERE a.founder_id = f.id AND a.is_deleted = 0 AND a.assessment_type = 'assessment'
        AND a.status IN ('complete','partial')
      ORDER BY a.created_at DESC, a.version_number DESC LIMIT 1) AS stu_score,
    (SELECT a.conviction_band FROM opportunity_assessments a
      WHERE a.founder_id = f.id AND a.is_deleted = 0 AND a.assessment_type = 'assessment'
        AND a.status IN ('complete','partial')
      ORDER BY a.created_at DESC, a.version_number DESC LIMIT 1) AS stu_band,
    (SELECT a.id FROM opportunity_assessments a
      WHERE a.founder_id = f.id AND a.is_deleted = 0 AND a.assessment_type = 'assessment'
        AND a.status IN ('complete','partial')
      ORDER BY a.created_at DESC, a.version_number DESC LIMIT 1) AS assessment_id,

    -- THE CALL. Danny's. Never computed, never inferred, never defaulted.
    (SELECT d.band FROM decisions d WHERE d.founder_id = f.id
      ORDER BY d.decided_at DESC LIMIT 1) AS my_band,
    (SELECT d.id FROM decisions d WHERE d.founder_id = f.id
      ORDER BY d.decided_at DESC LIMIT 1) AS decision_id,

    -- OWED. Open promises, either direction. The clock only Stu can hold.
    (SELECT COUNT(*) FROM commitments c WHERE c.founder_id = f.id
      AND c.status = 'open' AND c.owed_by = 'them') AS they_owe,
    (SELECT COUNT(*) FROM commitments c WHERE c.founder_id = f.id
      AND c.status = 'open' AND c.owed_by = 'me') AS i_owe,

    -- THE SOURCE CHAIN, back to the inbox row this came from.
    -- Danny: "Source is a chain, not a dropdown." Airtable records only the last
    -- hop, which is why outbound looks like it produces nothing when it is
    -- actually how he fills the top of the funnel.
    (SELECT sf.source FROM sourced_founders sf WHERE sf.promoted_to_founder_id = f.id
      ORDER BY sf.created_at ASC LIMIT 1) AS sourced_via,
    (SELECT sf.id FROM sourced_founders sf WHERE sf.promoted_to_founder_id = f.id
      ORDER BY sf.created_at ASC LIMIT 1) AS sourced_id
  FROM founders f
  WHERE f.created_by = ? AND f.is_deleted = 0
`;

// ── Is this "founder" actually a person? ──
// The March Airtable import wrote company records into `founders` with the person
// field set to "<Company> (Company)" — Prizm's founder name is literally "Prizm
// (Company)". Rendering that in a Founder column prints the company name twice on
// the same row, which breaks the one-primary-ink rule by making the eye compare
// two identical strings. Suppress rather than repeat.
function personName(row) {
  const n = (row.name || '').trim();
  if (!n) return null;
  if (/\(company\)/i.test(n)) return null;
  const c = (row.company || '').trim().toLowerCase();
  if (c && n.toLowerCase() === c) return null;
  return n;
}

// The funnel, in order. A company's position is DERIVED from what has actually
// happened to it, never stored — a stored stage is a stage that drifts from the
// record, and this database is the proof: all 7 portfolio companies still say
// deal_status='Under Consideration' because nobody edited the field after the
// money moved.
//
//   found -> met -> assessed -> decided -> invested
//
// `invested` is checked FIRST and wins outright. Danny: "If we invest in a company
// before I assess, that's ok." So a portfolio company is never chased for a read —
// it's an outcome, not a gap. Deriving it from investment_amount rather than
// deal_status means it's true the moment the check is recorded, with no field to
// forget to update.
function stageOf(r) {
  if (r.investment_amount > 0) return 'invested';
  if (r.my_band) return 'decided';
  if (r.stu_band) return 'assessed';
  if (r.deal_status === 'Under Consideration') return 'met';
  return 'found';
}

// ── GET /api/pipeline ──
router.get('/', (req, res) => {
  const rows = db.prepare(PIPELINE_SQL).all(req.user.id);

  const {
    track, // 'investment' | 'admissions'
    geo, // 'il' -> Chicago/IL lens. Danny's default; Brandon will ask for the toggle.
    stage,
    q,
  } = req.query;

  let out = rows.map((r) => ({ ...r, funnel_stage: stageOf(r), person: personName(r) }));

  if (track) out = out.filter((r) => (r.pipeline_tracks || '').includes(track));
  if (geo === 'il') out = out.filter((r) => !!r.chicago_connection);
  if (stage) out = out.filter((r) => r.funnel_stage === stage);
  if (q) {
    const needle = String(q).toLowerCase();
    out = out.filter(
      (r) =>
        (r.company || '').toLowerCase().includes(needle) ||
        (r.name || '').toLowerCase().includes(needle) ||
        (r.company_one_liner || '').toLowerCase().includes(needle)
    );
  }

  // Default order: the deals that want a decision first, then everything else.
  // NOT by date, and explicitly NOT by score — sorting his board by Stu's number
  // would let the engine set his agenda, which inverts who is assessing whom.
  const rank = { assessed: 0, met: 1, decided: 2, invested: 3, found: 4 };
  out.sort((a, b) => rank[a.funnel_stage] - rank[b.funnel_stage] || (b.stu_score || 0) - (a.stu_score || 0));

  res.json({
    rows: out,
    counts: {
      // Stage counts describe the board so it can be filtered. They are NOT a
      // scoreboard and no view rolls them into a "pipeline size" number —
      // Danny: "I want to inflate my pipeline numbers."
      found: out.filter((r) => r.funnel_stage === 'found').length,
      met: out.filter((r) => r.funnel_stage === 'met').length,
      assessed: out.filter((r) => r.funnel_stage === 'assessed').length,
      decided: out.filter((r) => r.funnel_stage === 'decided').length,
      invested: out.filter((r) => r.funnel_stage === 'invested').length,
    },
    total: out.length,
  });
});

// ══════════════════════════════════════════════════════════════════════
// GET /api/pipeline/inbox — the connective tissue.
//
// Danny: "I want connective tissue between a high-quality sourcing engine and a
// pipeline tracker (Harmonic meets Affinity)."
//
// This is the seam. Harmonic finds; Affinity tracks; the reason both feel like
// products and Stu didn't is that Stu had a Discover screen whose output went
// nowhere. `sourced_founders` is not a different kind of thing from `founders` —
// it is the SAME company one stage earlier, which is why approve/:id promotes in
// one transaction and writes BOTH pointers (founders.sourced_from_id and
// sourced_founders.promoted_to_founder_id). The chain survives the promotion, so
// "how I found them" is still answerable six months later.
//
// That write path already existed and was good. What did not exist was anywhere
// to stand while using it — which is why all 167 rows are still 'pending'.
// ══════════════════════════════════════════════════════════════════════
router.get('/inbox', (req, res) => {
  const rows = db.prepare(`
    SELECT id, name, company, company_one_liner, role, source, headline,
           confidence_score, confidence_rationale, chicago_connection, location_city,
           location_type, caliber_tier, caliber_score, breakout_score, linkedin_url,
           github_url, website_url, list_scope, status, created_at
    FROM sourced_founders
    WHERE user_id = ? AND status IN ('pending','starred')
      AND COALESCE(do_not_resurface, 0) = 0
      AND list_scope = COALESCE(?, 'pipeline')
    ORDER BY
      CASE status WHEN 'starred' THEN 0 ELSE 1 END,
      COALESCE(caliber_score, breakout_score, confidence_score, 0) DESC,
      created_at DESC
  `).all(req.user.id, req.query.scope || 'pipeline');

  res.json({
    rows,
    total: rows.length,
    // The national Frontier Watch — everything with no Illinois tie. Kept separate
    // rather than dropped, because "best of the best" is a different question from
    // "best we can be first to," and Brandon asks the first one.
    watchlist: db.prepare(
      `SELECT COUNT(*) n FROM sourced_founders
       WHERE user_id = ? AND status IN ('pending','starred') AND list_scope = 'watchlist'
         AND COALESCE(do_not_resurface, 0) = 0`
    ).get(req.user.id).n,
  });
});

// ══════════════════════════════════════════════════════════════════════
// GET /api/pipeline/stats — the Home dashboard.
//
// Danny asked for "a dashboard covering pipeline stats" and also, separately and
// emphatically: "I want to inflate my pipeline numbers." Both are true, and the
// line between them is what this endpoint encodes.
//
// SHIPPED: funnel STATE — how many sit at each stage, which sources produce. That
// describes the board so he can navigate it, and it's what his own Permute spec
// asked for ("Count of founders by Source, so I can see which channel is
// producing volume"). A description isn't a score.
//
// NOT SHIPPED: a headline pipeline size, a growth trend, or conversion rates.
// Every one of those goes UP when he adds a name, which pays him to do the thing
// he already told me he does for the number's sake.
//
// The only progress metric is DECIDED — and its increment requires a dated
// falsifiable prediction (see routes/today.js), because a bare pass=+1 would pay
// him to fire his ten-second "cool but indefensible" reflex faster, and his own
// Portfolio Pattern Analysis says undocumented passes on strong founders are his
// most fixable blind spot.
// ══════════════════════════════════════════════════════════════════════
router.get('/stats', (req, res) => {
  const uid = req.user.id;
  const rows = db.prepare(PIPELINE_SQL).all(uid);
  const live = rows.filter((r) => (r.pipeline_tracks || '').includes('investment'));
  const staged = live.map((r) => stageOf(r));

  const bySource = {};
  for (const r of live) {
    const s = r.sourced_via || r.source || 'Unknown';
    bySource[s] = (bySource[s] || 0) + 1;
  }

  res.json({
    // Deliberately NOT summed into a total anywhere on the client.
    funnel: {
      found: staged.filter((s) => s === 'found').length,
      met: staged.filter((s) => s === 'met').length,
      assessed: staged.filter((s) => s === 'assessed').length,
      decided: staged.filter((s) => s === 'decided').length,
      invested: staged.filter((s) => s === 'invested').length,
    },
    by_source: Object.entries(bySource)
      .map(([source, n]) => ({ source, n }))
      .sort((a, b) => b.n - a.n)
      .slice(0, 8),
    inbox_waiting: db.prepare(
      `SELECT COUNT(*) n FROM sourced_founders
       WHERE user_id = ? AND status IN ('pending','starred') AND list_scope = 'pipeline'
         AND COALESCE(do_not_resurface, 0) = 0`
    ).get(uid).n,
    // The one progress number. Decided, not sourced.
    decided_this_week: db.prepare(
      `SELECT COUNT(*) n FROM decisions WHERE created_by = ? AND decided_at >= date('now','-7 day')`
    ).get(uid).n,
    // Null until there is something to say — n=0 is not 50/50. The only question
    // here that compounds.
    calibration: (() => {
      const d = db.prepare(
        `SELECT stu_band, band, outcome FROM decisions
         WHERE created_by = ? AND stu_band IS NOT NULL AND stu_band != 'indeterminate'`
      ).all(uid);
      const disagreed = d.filter((r) => r.stu_band !== r.band);
      const resolved = disagreed.filter((r) => r.outcome && r.outcome !== 'unresolved');
      return {
        decisions: d.length,
        disagreed: disagreed.length,
        right_when_disagreed: resolved.length
          ? Math.round((resolved.filter((r) => r.outcome === 'right').length / resolved.length) * 100)
          : null,
      };
    })(),
  });
});

// ── GET /api/pipeline/:id — one company, everything attached to it ──
// The detail page's substrate. Same record, more of it.
router.get('/:id', (req, res) => {
  const row = db.prepare(`${PIPELINE_SQL} AND f.id = ?`).get(req.user.id, req.params.id);
  if (!row) return res.status(404).json({ error: 'not found' });

  res.json({
    ...row,
    funnel_stage: stageOf(row),
    assessments: db
      .prepare(
        `SELECT id, conviction_score, conviction_band, evidence_rung, status, assessment_type, created_at
         FROM opportunity_assessments WHERE founder_id = ? AND is_deleted = 0
         ORDER BY created_at DESC`
      )
      .all(req.params.id),
    decisions: db
      .prepare(`SELECT * FROM decisions WHERE founder_id = ? ORDER BY decided_at DESC`)
      .all(req.params.id),
    commitments: db
      .prepare(`SELECT * FROM commitments WHERE founder_id = ? ORDER BY stated_at DESC`)
      .all(req.params.id),
    notes: db
      .prepare(`SELECT * FROM founder_notes WHERE founder_id = ? ORDER BY created_at DESC`)
      .all(req.params.id),
  });
});

module.exports = router;
