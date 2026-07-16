import { useState, useEffect, useMemo } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { api } from '../utils/api';
import KanbanBoard from '../components/KanbanBoard';

// ══════════════════════════════════════════════════════════════════════════
// Pipeline — managing companies you're already tracking.
//
// Danny, 2026-07-15: "we're conflating two actions here: 1) I need an inbox to
// study and triage new founders (true sourcing) and 2) the ability to manage a
// pipeline (like a kanban)... right now, this screen is a jumble."
//
// He was right. The insight that Stu has ONE object moving through stages is
// about the DATA, not the SCREENS — Affinity and Attio both have one substrate
// AND separate surfaces. So sourcing moved to its own screen and this one does
// one job: move companies you know through your deal stages.
//
// ── WHY THE KANBAN GROUPS BY deal_status, NOT THE DERIVED FUNNEL ──
// There are two different "stage" ideas in this product and they must not be
// confused:
//
//   deal_status    — YOUR workflow. Editable. Under Consideration -> First
//                    Meeting -> Partner Call -> Memo Draft -> IC Review ->
//                    Committed / Passed. This is what a card DRAGS between.
//   funnel_stage   — DERIVED from evidence (found/met/assessed/decided/invested).
//                    Read-only by construction: you cannot drag a card to make a
//                    company "assessed" — either an assessment exists or it
//                    doesn't. Dragging into it would be a lie.
//
// So the kanban is the workflow, and the derived read lives in the table view and
// on Home. A board you can drag has to write something real.
// ══════════════════════════════════════════════════════════════════════════

// ══════════════════════════════════════════════════════════════════════════
// The stages that EXIST, measured against the real board (2026-07-16):
//   Under Consideration 42 · Passed 35 · (empty) 25 · Family office 3
// First Meeting, Partner Call, Memo Draft, IC Review and Committed had ZERO rows
// each — five of seven columns were permanent placeholders. A board that is 70%
// empty scaffolding reads as a board with nothing on it.
//
// FAMILY OFFICE is Danny's own category, from his pipeline dump: "likely a family
// office opportunity vs. Superior." It isn't a pass — it's the wrong door. Brandon's
// family office invests Series A through pre-IPO; Superior writes $150-400K at
// pre-seed. A company raising a Series A in Q1 2027 is a real opportunity for the
// building and a bad fit for the fund, and the board had no word for that. Filing
// those as "Passed" would have been a lie about three live relationships.
//
// The middle stages return when a deal actually reaches one. An empty column you
// can't drag into is worse than no column: it implies a process that isn't running.
const DEAL_STAGES = [
  'Under Consideration', 'Memo Draft', 'IC Review', 'Committed',
  'Family office', 'Passed',
];

const BAND_LABEL = { anchor: 'Anchor', memo: 'Memo', monitor: 'Monitor', pass: 'Pass', indeterminate: 'Held' };

// The band renders as weight and position on the ink ramp, never as color. A
// colored verdict tells him what to think before he's read the evidence.
function Band({ band, score, muted }) {
  if (!band) return <span className="text-ink-4">—</span>;
  return (
    <span className={`band band-${band} ${muted ? 'opacity-60' : ''}`}>
      {BAND_LABEL[band] || band}
      {score != null && <span className="num text-ink-3 font-normal ml-1">{Number(score).toFixed(1)}</span>}
    </span>
  );
}

export default function Pipeline() {
  const nav = useNavigate();
  const [params, setParams] = useSearchParams();
  const [data, setData] = useState(null);
  const [err, setErr] = useState(null);
  const [view, setView] = useState(() => localStorage.getItem('stu_pipeline_view') || 'kanban');
  const [track, setTrack] = useState('investment');
  const [q, setQ] = useState('');
  const [cursor, setCursor] = useState(0);
  const stage = params.get('stage') || '';

  useEffect(() => { localStorage.setItem('stu_pipeline_view', view); }, [view]);

  // ── Stale-while-revalidate. Do NOT setData(null) here. ──
  // Danny: "Pipeline took awhile to load." Blanking to a skeleton on every track
  // toggle turns a 20ms cached response into a visible cold load — the UI throws
  // away a perfectly good board, shows bones, then paints the same rows back.
  // Keeping the old rows on screen while the new ones fetch is the entire
  // difference between "instant" and "laggy" at identical network cost.
  //
  // The response is cached per-track in a module-level Map (see api.js), so
  // toggling back to a track you've already seen is 0 requests and 0 flicker.
  useEffect(() => {
    let dead = false;
    api.getPipeline({ track }).then((d) => !dead && setData(d)).catch((e) => !dead && setErr(e.message));
    return () => { dead = true; };
  }, [track]);

  const rows = useMemo(() => {
    if (!data) return [];
    let out = data.rows;
    if (stage) out = out.filter((r) => r.funnel_stage === stage);
    if (q) {
      const n = q.toLowerCase();
      out = out.filter(
        (r) => (r.company || '').toLowerCase().includes(n) ||
               (r.person || '').toLowerCase().includes(n) ||
               (r.company_one_liner || '').toLowerCase().includes(n)
      );
    }
    return out;
  }, [data, stage, q]);

  useEffect(() => {
    if (view !== 'list') return;
    function onKey(e) {
      if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA') return;
      if (e.key === 'j') setCursor((c) => Math.min(c + 1, rows.length - 1));
      else if (e.key === 'k') setCursor((c) => Math.max(c - 1, 0));
      else if (e.key === 'Enter' && rows[cursor]) nav(`/founders/${rows[cursor].id}`);
      else return;
      e.preventDefault();
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [rows, cursor, nav, view]);

  // Dragging writes deal_status — the real workflow field. Optimistic, because a
  // drag that waits on a round trip feels broken.
  async function onStageChange(founderId, newStage) {
    setData((d) => ({
      ...d,
      rows: d.rows.map((r) => (r.id === founderId ? { ...r, deal_status: newStage } : r)),
    }));
    try { await api.updateFounder(founderId, { deal_status: newStage }); }
    catch (e) { setErr(e.message); api.getPipeline({ track }).then(setData); }
  }

  if (err) return <div className="p-4 text-small text-danger">{err}</div>;

  return (
    <div className="flex flex-col h-full">
      <div className="flex items-center gap-2 px-3 h-8 border-b border-line-2 bg-ground flex-shrink-0">
        <span className="text-small font-semibold text-ink">Pipeline</span>
        <input
          className="input w-44 border-0 bg-transparent focus:ring-0 px-0 ml-2"
          placeholder="Filter…"
          value={q}
          onChange={(e) => { setQ(e.target.value); setCursor(0); }}
        />
        {stage && (
          <button
            onClick={() => setParams({})}
            className="px-2 h-6 rounded text-mini font-medium bg-ground-4 text-ink capitalize"
            title="Clear the filter from Home"
          >
            {stage} <span className="text-ink-4 ml-1">×</span>
          </button>
        )}
        <div className="flex-1" />

        <div className="flex items-center gap-px">
          {['investment', 'admissions'].map((t) => (
            <button
              key={t}
              onClick={() => setTrack(t)}
              className={`px-2 h-6 rounded text-mini font-medium capitalize transition ${
                track === t ? 'bg-ground-4 text-ink' : 'text-ink-3 hover:text-ink hover:bg-ground-3'
              }`}
            >
              {t}
            </button>
          ))}
        </div>
        <div className="flex items-center gap-px ml-2 border-l border-line-2 pl-2">
          {[
            { k: 'kanban', label: 'Board' },
            { k: 'list', label: 'Table' },
          ].map((v) => (
            <button
              key={v.k}
              onClick={() => setView(v.k)}
              className={`px-2 h-6 rounded text-mini font-medium transition ${
                view === v.k ? 'bg-ground-4 text-ink' : 'text-ink-3 hover:text-ink hover:bg-ground-3'
              }`}
            >
              {v.label}
            </button>
          ))}
        </div>
        <span className="num text-mini text-ink-4 pl-2">{rows.length}</span>
      </div>

      {!data ? (
        <div className="flex-1 p-3">
          <div className="flex gap-3">
            {Array.from({ length: 5 }).map((_, i) => (
              <div key={i} className="flex-1 border border-line rounded-md p-2 space-y-2">
                {Array.from({ length: 3 }).map((__, j) => (
                  <div key={j} className="h-8 bg-ground-3 rounded-sm" />
                ))}
              </div>
            ))}
          </div>
        </div>
      ) : view === 'kanban' ? (
        <div className="flex-1 overflow-auto p-3">
          <KanbanBoard
            founders={rows}
            stages={track === 'investment' ? DEAL_STAGES : ADMISSIONS_STAGES}
            track={track}
            onStageChange={onStageChange}
          />
        </div>
      ) : (
        <>
          <div className="flex items-center h-6 px-3 border-b border-line-2 bg-ground-3 text-micro font-semibold uppercase text-ink-4 flex-shrink-0">
            <span className="flex-[3] min-w-0">Company</span>
            <span className="flex-[2] min-w-0">Founder</span>
            <span className="w-20">Stage</span>
            <span className="w-24">Read · Stu</span>
            <span className="w-24">Call · You</span>
            <span className="w-14 text-right">Owed</span>
          </div>
          <div className="flex-1 overflow-y-auto">
            {rows.length === 0 ? (
              <div className="px-3 py-4 text-small text-ink-3">
                Nothing here.{' '}
                <button className="text-accent" onClick={() => nav('/sourcing')}>Go find someone →</button>
              </div>
            ) : (
              rows.map((r, i) => (
                <div
                  key={r.id}
                  onClick={() => nav(`/founders/${r.id}`)}
                  onMouseEnter={() => setCursor(i)}
                  className={`row px-3 cursor-pointer ${i === cursor ? 'row-selected' : ''}`}
                >
                  {/* The ONE primary ink in the row. flex-none so the one-liner
                      truncates instead of crushing the company name to 16px. */}
                  <span className="flex-[3] min-w-0 flex items-baseline gap-2">
                    <span className="row-primary flex-none max-w-[200px]">{r.company || r.person || r.name}</span>
                    {r.company_one_liner && <span className="row-meta min-w-0 hidden xl:inline">{r.company_one_liner}</span>}
                  </span>
                  <span className="flex-[2] min-w-0 text-ink-2 truncate">
                    {r.person || <span className="text-ink-4">—</span>}
                  </span>
                  <span className="w-20 text-ink-3 text-mini capitalize">{r.funnel_stage}</span>
                  <span className="w-24"><Band band={r.stu_band} score={r.stu_score} muted /></span>
                  <span className="w-24"><Band band={r.my_band} /></span>
                  <span className="w-14 text-right num text-mini">
                    {r.they_owe > 0 ? <span className="text-ink font-medium">{r.they_owe}</span>
                      : r.i_owe > 0 ? <span className="text-ink-2">{r.i_owe}</span>
                      : <span className="text-ink-4">—</span>}
                  </span>
                </div>
              ))
            )}
          </div>
          <div className="flex items-center gap-3 px-3 h-6 border-t border-line-2 bg-ground text-micro text-ink-4 flex-shrink-0">
            <span><kbd className="text-ink-3">j</kbd>/<kbd className="text-ink-3">k</kbd> move</span>
            <span><kbd className="text-ink-3">↵</kbd> open the card</span>
          </div>
        </>
      )}
    </div>
  );
}

// 'Density Resident' has 21 rows and was NOT in this list — so the biggest single
// cohort on the admissions board fell through to KanbanBoard's fallback and
// rendered AFTER the canonical stages, out of lifecycle order. Measured:
//   Hold/Nurture 40 · Density Resident 21 · Not Admitted 20 · Sourced 18 ·
//   Outreach 17 · First Call Complete 17 · First Call Scheduled 14 ·
//   Active Resident 9 · Second Call Scheduled 6
// 'Admitted', 'Alumni' and 'Second Call Complete' have zero and are dropped.
const ADMISSIONS_STAGES = [
  'Sourced', 'Outreach', 'First Call Scheduled', 'First Call Complete',
  'Second Call Scheduled', 'Density Resident', 'Active Resident',
  'Hold/Nurture', 'Not Admitted',
];
