import { useState, useEffect, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import { api } from '../utils/api';

// ══════════════════════════════════════════════════════════════════════════
// Pipeline — the front door.
//
// Danny, five times, verbatim: "my personal Affinity/Harmonic — sourcing,
// tracking, assessing." That is one sentence about ONE object moving through a
// funnel: found -> met -> assessed -> decided. Sourcing is this screen's inbox.
// Assess is this screen's detail page. They were never three products.
//
// What this replaced: 613 lines of three tabs (Inbox / Admissions / Investment),
// a kanban, and a set of colored status badges — a screen that knew nothing about
// assessments, commitments, or decisions. It was a list of names, not a pipeline.
//
// The two columns that carry the whole thesis are READ and CALL. Stu's band and
// Danny's band, side by side, never merged. Where they disagree is the only data
// in this product that compounds — and the one question no tool he can buy can
// answer, because answering it needs a record of what he thought before he knew.
//
// Design rules in force here (see tailwind.config.js):
//   · 32px rows, 8px padding, hairlines, FULL BLEED. ~24 rows on screen.
//   · ONE primary ink per row — the company name. Everything else recedes.
//   · Bands are TYPOGRAPHIC. A colored verdict tells him what to think before
//     he has read the evidence.
//   · Urgency is a promotion up the ink ramp, never a new hue.
// ══════════════════════════════════════════════════════════════════════════

const BAND_LABEL = {
  anchor: 'Anchor',
  memo: 'Memo',
  monitor: 'Monitor',
  pass: 'Pass',
  indeterminate: 'Held',
};

// The band renders as weight and position on the ink ramp, never as color.
function Band({ band, score, muted }) {
  if (!band) return <span className="text-ink-4">—</span>;
  return (
    <span className={`band band-${band} ${muted ? 'opacity-60' : ''}`}>
      {BAND_LABEL[band] || band}
      {score != null && <span className="num text-ink-3 font-normal ml-1">{Number(score).toFixed(1)}</span>}
    </span>
  );
}

// The funnel, left to right. `inbox` is not a founders stage — it's the sourcing
// engine's output, one step before the board — but it sits on the same control bar
// because it IS the same object one stage earlier. That adjacency is the whole
// "Harmonic meets Affinity" seam: find and track are one motion, not two products.
const STAGES = [
  { key: 'inbox', label: 'Inbox' },
  { key: '', label: 'All' },
  { key: 'found', label: 'Found' },
  { key: 'met', label: 'Met' },
  { key: 'assessed', label: 'Assessed' },
  { key: 'decided', label: 'Decided' },
  { key: 'invested', label: 'Invested' },
];

export default function Pipeline() {
  const nav = useNavigate();
  const [data, setData] = useState(null);
  const [inbox, setInbox] = useState(null);
  const [attention, setAttention] = useState(null);
  const [err, setErr] = useState(null);
  const [stage, setStage] = useState('');
  const [track, setTrack] = useState('investment');
  const [geo, setGeo] = useState(false);
  const [q, setQ] = useState('');
  const [cursor, setCursor] = useState(0);
  const [busy, setBusy] = useState(null);

  useEffect(() => {
    let dead = false;
    setData(null);
    api
      .getPipeline({ track, ...(geo ? { geo: 'il' } : {}) })
      .then((d) => !dead && setData(d))
      .catch((e) => !dead && setErr(e.message));
    return () => { dead = true; };
  }, [track, geo]);

  useEffect(() => {
    api.getPipelineInbox().then(setInbox).catch(() => setInbox(null));
    api.getAttention().then(setAttention).catch(() => setAttention(null));
  }, []);

  // Approve = promote. One transaction on the server writes the founder row AND
  // both direction pointers, so the source chain survives. Optimistic here: the
  // row leaves the inbox immediately and is restored if the server disagrees —
  // triage that waits on a round trip is triage he stops doing.
  async function triage(row, action) {
    setBusy(row.id);
    const before = inbox;
    setInbox((s) => ({ ...s, rows: s.rows.filter((r) => r.id !== row.id), total: s.total - 1 }));
    try {
      if (action === 'approve') {
        const founder = await api.approveSourced(row.id);
        // The promotion changes the board, so the board has to re-read. This is the
        // seam working: one click, and a sourced name is a tracked company.
        api.getPipeline({ track, ...(geo ? { geo: 'il' } : {}) }).then(setData);
        api.getAttention().then(setAttention).catch(() => {});
        return founder;
      }
      if (action === 'dismiss') await api.dismissSourced(row.id);
      if (action === 'hide') await api.hideForeverSourced(row.id);
    } catch (e) {
      setInbox(before);
      setErr(e.message);
    } finally {
      setBusy(null);
    }
  }

  // Filter on the client. 187 rows — a round trip to re-filter a list this small
  // would be slower than the keystroke. Precompute, never spin.
  const rows = useMemo(() => {
    if (!data) return [];
    let out = data.rows;
    if (stage) out = out.filter((r) => r.funnel_stage === stage);
    if (q) {
      const n = q.toLowerCase();
      out = out.filter(
        (r) =>
          (r.company || '').toLowerCase().includes(n) ||
          (r.name || '').toLowerCase().includes(n) ||
          (r.company_one_liner || '').toLowerCase().includes(n)
      );
    }
    return out;
  }, [data, stage, q]);

  // j/k to move, Enter to open. Single unmodified keys for the highest-frequency
  // verbs — Danny lives on this screen or the rebuild failed.
  useEffect(() => {
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
  }, [rows, cursor, nav]);

  if (err) return <div className="p-4 text-small text-danger">{err}</div>;

  return (
    <div className="flex flex-col h-full">
      <Attention data={attention} onOpen={(fid) => fid && nav(`/founders/${fid}`)} />

      {/* Controls — one 32px bar. No card, no shadow. */}
      <div className="flex items-center gap-2 px-2 h-8 border-b border-line-2 bg-ground flex-shrink-0">
        <input
          className="input w-56 border-0 bg-transparent focus:ring-0 px-0"
          placeholder="Filter companies…"
          value={q}
          onChange={(e) => { setQ(e.target.value); setCursor(0); }}
        />
        <div className="flex items-center gap-px">
          {STAGES.map((s) => (
            <button
              key={s.key}
              onClick={() => { setStage(s.key); setCursor(0); }}
              className={`px-2 h-6 rounded text-mini font-medium transition ${
                stage === s.key ? 'bg-ground-4 text-ink' : 'text-ink-3 hover:text-ink hover:bg-ground-3'
              }`}
            >
              {s.label}
              {s.key === 'inbox'
                ? inbox && <span className="num text-ink-4 ml-1">{inbox.total}</span>
                : s.key && data && <span className="num text-ink-4 ml-1">{data.counts[s.key]}</span>}
            </button>
          ))}
        </div>

        <div className="flex-1" />

        {/* Brandon will ask for the national view. One toggle, whole board. */}
        <button
          onClick={() => setGeo((g) => !g)}
          className={`px-2 h-6 rounded text-mini font-medium transition ${
            geo ? 'bg-ground-4 text-ink' : 'text-ink-3 hover:text-ink hover:bg-ground-3'
          }`}
          title="Chicago / Illinois ties only"
        >
          IL only
        </button>
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
        <span className="num text-mini text-ink-4 pl-2">{rows.length}</span>
      </div>

      {stage === 'inbox' ? (
        <Inbox data={inbox} busy={busy} onTriage={triage} q={q} />
      ) : (
        <>
      {/* Header row — same grid as the data, so the columns actually line up. */}
      <div className="flex items-center h-6 px-2 border-b border-line-2 bg-ground-3 text-micro font-semibold uppercase text-ink-4 flex-shrink-0">
        <span className="flex-[3] min-w-0">Company</span>
        <span className="flex-[2] min-w-0">Founder</span>
        <span className="w-20">Stage</span>
        <span className="w-28">Source</span>
        <span className="w-24">Read · Stu</span>
        <span className="w-24">Call · You</span>
        <span className="w-16 text-right">Owed</span>
      </div>

      <div className="flex-1 overflow-y-auto">
        {!data ? (
          // Skeleton, not a spinner — it holds the shape the data will take, so the
          // page never reflows. Permute does this; it's why their load feels instant.
          Array.from({ length: 16 }).map((_, i) => (
            <div key={i} className="row">
              <span className="flex-[3]"><span className="block h-2 w-32 bg-ground-3 rounded-sm" /></span>
              <span className="flex-[2]"><span className="block h-2 w-24 bg-ground-3 rounded-sm" /></span>
              <span className="w-20"><span className="block h-2 w-12 bg-ground-3 rounded-sm" /></span>
              <span className="w-28"><span className="block h-2 w-16 bg-ground-3 rounded-sm" /></span>
              <span className="w-24"><span className="block h-2 w-10 bg-ground-3 rounded-sm" /></span>
              <span className="w-24"><span className="block h-2 w-10 bg-ground-3 rounded-sm" /></span>
              <span className="w-16" />
            </div>
          ))
        ) : rows.length === 0 ? (
          <div className="px-2 py-4 text-small text-ink-3">
            Nothing matches.{' '}
            {q && <button className="text-accent" onClick={() => setQ('')}>Clear the filter</button>}
          </div>
        ) : (
          rows.map((r, i) => (
            <div
              key={r.id}
              onClick={() => nav(`/founders/${r.id}`)}
              onMouseEnter={() => setCursor(i)}
              className={`row cursor-pointer ${i === cursor ? 'row-selected' : ''}`}
            >
              {/* The ONE primary ink in the row.
                  `flex-none` is load-bearing: when the name and the one-liner both
                  flexed, the browser gave the one-liner the space and crushed 27 of
                  105 company names down to 16px — "Electrokare" rendered as "Ele…"
                  while its tagline sat next to it in full. The primary ink must never
                  yield to the thing that recedes; the one-liner is what truncates. */}
              <span className="flex-[3] min-w-0 flex items-baseline gap-2">
                <span className="row-primary flex-none max-w-[200px]">{r.company || r.name}</span>
                {r.company_one_liner && (
                  <span className="row-meta min-w-0 hidden xl:inline">{r.company_one_liner}</span>
                )}
              </span>
              {/* `person`, not `name` — the import stored some rows' founder as
                  "<Company> (Company)". See personName() in routes/pipeline.js. */}
              <span className="flex-[2] min-w-0 text-ink-2 truncate">
                {r.person || <span className="text-ink-4">—</span>}
              </span>
              <span className="w-20 text-ink-3 text-mini capitalize">{r.funnel_stage}</span>
              {/* Source is a CHAIN. Where the row came from beats the last hop. */}
              <span
                className="w-28 text-ink-3 text-mini truncate"
                title={r.sourced_via ? `sourced via ${r.sourced_via}` : r.source || ''}
              >
                {r.sourced_via || r.source || '—'}
              </span>
              <span className="w-24"><Band band={r.stu_band} score={r.stu_score} muted /></span>
              <span className="w-24"><Band band={r.my_band} /></span>
              {/* Urgency by ink promotion, not by hue. */}
              <span className="w-16 text-right num text-mini">
                {r.they_owe > 0 ? (
                  <span className="text-ink font-medium">{r.they_owe}</span>
                ) : r.i_owe > 0 ? (
                  <span className="text-ink-2">{r.i_owe}</span>
                ) : (
                  <span className="text-ink-4">—</span>
                )}
              </span>
            </div>
          ))
        )}
      </div>
        </>
      )}

      <div className="flex items-center gap-3 px-2 h-6 border-t border-line-2 bg-ground text-micro text-ink-4 flex-shrink-0">
        <span><kbd className="text-ink-3">j</kbd>/<kbd className="text-ink-3">k</kbd> move</span>
        <span><kbd className="text-ink-3">↵</kbd> open</span>
        <span><kbd className="text-ink-3">⌘K</kbd> search</span>
      </div>
    </div>
  );
}

// ══════════════════════════════════════════════════════════════════════════
// The Inbox — the sourcing engine's output, one click from the board.
//
// Danny: "I want connective tissue between a high-quality sourcing engine and a
// pipeline tracker (Harmonic meets Affinity)."
//
// The old Discover screen was a search box you had to operate, and its output went
// nowhere — you approved someone and they became a different record with no way
// back to how you found them. This is the same list, but the row's only job is to
// be triaged, and approving it promotes the SAME record onto the board with its
// source chain intact.
//
// Harmonic's own lesson: the alert is the product and the search bar is its config
// UI. This should fill overnight and be waiting.
// ══════════════════════════════════════════════════════════════════════════
function Inbox({ data, busy, onTriage, q }) {
  const rows = useMemo(() => {
    if (!data) return [];
    if (!q) return data.rows;
    const n = q.toLowerCase();
    return data.rows.filter(
      (r) =>
        (r.company || '').toLowerCase().includes(n) ||
        (r.name || '').toLowerCase().includes(n) ||
        (r.headline || '').toLowerCase().includes(n)
    );
  }, [data, q]);

  return (
    <>
      <div className="flex items-center h-6 px-2 border-b border-line-2 bg-ground-3 text-micro font-semibold uppercase text-ink-4 flex-shrink-0">
        <span className="flex-[2] min-w-0">Person</span>
        <span className="flex-[3] min-w-0">Signal</span>
        <span className="w-36">IL tie</span>
        <span className="w-24">Found via</span>
        <span className="w-14 text-right">Caliber</span>
        <span className="w-40 text-right pr-1">Triage</span>
      </div>

      <div className="flex-1 overflow-y-auto">
        {!data ? (
          Array.from({ length: 12 }).map((_, i) => (
            <div key={i} className="row">
              <span className="flex-[2]"><span className="block h-2 w-28 bg-ground-3 rounded-sm" /></span>
              <span className="flex-[3]"><span className="block h-2 w-48 bg-ground-3 rounded-sm" /></span>
              <span className="w-28"><span className="block h-2 w-16 bg-ground-3 rounded-sm" /></span>
              <span className="w-16" />
              <span className="w-40" />
            </div>
          ))
        ) : rows.length === 0 ? (
          // Not a blank state — a diagnosis. An empty inbox means one of two very
          // different things (nothing found vs. the scout never ran) and saying the
          // wrong one is how the old Discover screen taught Danny it was broken.
          <div className="px-2 py-4 text-small text-ink-3 max-w-2xl">
            {data.total === 0 && !q ? (
              <>
                Inbox is empty. That means the scout found nothing new — not that it
                didn't run. {data.watchlist > 0 && `${data.watchlist} names are on the national Frontier Watch.`}
              </>
            ) : (
              'Nothing matches that filter.'
            )}
          </div>
        ) : (
          rows.map((r) => (
            <div key={r.id} className={`row group ${busy === r.id ? 'opacity-40' : ''}`}>
              <span className="flex-[2] min-w-0 flex items-baseline gap-2">
                <span className="row-primary flex-none max-w-[160px]">{r.name}</span>
                {r.company && <span className="row-meta min-w-0">{r.company}</span>}
              </span>
              {/* The reason this person is in front of him. The whole value of the
                  row — a name with no signal is a name he has no reason to read. */}
              <span className="flex-[3] min-w-0 text-ink-2 truncate" title={r.confidence_rationale || ''}>
                {r.headline || r.company_one_liner || r.confidence_rationale || (
                  <span className="text-ink-4">no signal recorded</span>
                )}
              </span>
              {/* WHY this person is allowed on the board. Geography is the moat, so
                  the tie is a column, not a hidden field — 55 of 85 rows here were
                  Stanford/Yale/CMU alumni carrying a fabricated Chicago tie, and it
                  survived four months precisely because nobody could see it. The
                  full evidence is on hover; a tie you can read is a tie you can
                  overrule. A `cofounder` tie is the company's, not the person's, so
                  it recedes a step down the ink ramp and says whose it is. */}
              <span
                className="w-36 min-w-0 text-mini truncate"
                title={r.chicago_connection || 'no verified Illinois tie'}
              >
                {r.location_type === 'cofounder' ? (
                  <span className="text-ink-3">via co-founder</span>
                ) : r.location_type ? (
                  <span className="text-ink-2">
                    {r.location_type}
                    <span className="text-ink-4"> · {String(r.chicago_connection || '').split(' — ')[0].split(': ')[1] || ''}</span>
                  </span>
                ) : (
                  <span className="text-ink-4">—</span>
                )}
              </span>
              <span className="w-24 text-ink-3 text-mini truncate">{r.source}</span>
              <span className="w-14 text-right num text-mini text-ink-3">
                {r.caliber_tier || r.caliber_score || r.confidence_score || '—'}
              </span>
              {/* Triage appears on hover. A row that isn't being worked shouldn't
                  carry three buttons of visual weight. */}
              <span className="w-40 flex items-center justify-end gap-1 opacity-0 group-hover:opacity-100 transition">
                <button
                  onClick={(e) => { e.stopPropagation(); onTriage(r, 'approve'); }}
                  className="px-2 h-5 rounded text-mini font-medium bg-ink text-white hover:bg-ink-2 transition"
                  title="Promote onto the board, keeping the source chain"
                >
                  Track
                </button>
                <button
                  onClick={(e) => { e.stopPropagation(); onTriage(r, 'dismiss'); }}
                  className="px-2 h-5 rounded text-mini text-ink-3 hover:bg-ground-4 hover:text-ink transition"
                >
                  Skip
                </button>
                <button
                  onClick={(e) => { e.stopPropagation(); onTriage(r, 'hide'); }}
                  className="px-2 h-5 rounded text-mini text-ink-4 hover:bg-ground-4 hover:text-ink-2 transition"
                  title="Never surface this person again"
                >
                  Never
                </button>
              </span>
            </div>
          ))
        )}
      </div>
    </>
  );
}

// ══════════════════════════════════════════════════════════════════════════
// The attention strip. Danny's own four rules (see server/lib/attention.js).
//
// Every check renders EVERY DAY, including when it is clean — the reason
// Permute's version is trustworthy is that "✓ no overdue follow-ups" sits right
// next to the amber one. A list that only appears when something is wrong is
// indistinguishable from a list that is broken. Silence must mean "I looked."
// ══════════════════════════════════════════════════════════════════════════
function Attention({ data, onOpen }) {
  const [open, setOpen] = useState(null);
  const [showClean, setShowClean] = useState(false);
  if (!data) return null;

  // Clean checks collapse to ONE line.
  //
  // Rendering all six at full height cost 340px — 38% of the viewport — before
  // Danny saw a single company, and four of those rows were saying "nothing is
  // wrong" at the same weight as the one thing that was. The guarantee that makes
  // this trustworthy is that silence means "I looked," and one line saying "4
  // checks clean" keeps that guarantee at a twelfth of the cost. It expands.
  const clean = data.checks.filter((c) => !c.count && !c.blocked);
  const live = data.checks.filter((c) => c.count || c.blocked);
  const shown = showClean ? data.checks : live;

  return (
    <div className="border-b border-line-2 bg-ground flex-shrink-0">
      <div className="flex items-center gap-2 px-2 h-8">
        <span className="label mb-0">Needs you today</span>
        <span className="num text-small font-semibold text-ink">{data.needs_attention}</span>
        <span className="text-mini text-ink-4">{data.needs_attention === 1 ? 'company' : 'companies'}</span>
        <span className="flex-1" />
        {clean.length > 0 && (
          <button
            onClick={() => setShowClean((s) => !s)}
            className="text-mini text-ink-4 hover:text-ink-2 transition"
          >
            <span className="text-ink-4">✓</span> {clean.length} clean
          </button>
        )}
      </div>

      <div className="pb-1">
        {shown.map((c) => {
          const isOpen = open === c.key;
          return (
            <div key={c.key}>
              <button
                onClick={() => setOpen(isOpen ? null : c.key)}
                disabled={!c.count}
                className={`w-full flex items-center gap-2 h-row px-2 text-small text-left transition ${
                  c.count ? 'hover:bg-ground-3 cursor-pointer' : 'cursor-default'
                }`}
              >
                <span className="w-3 text-center text-mini">
                  {c.blocked ? (
                    <span className="text-ink-4">·</span>
                  ) : c.count ? (
                    <span className="text-attention">▲</span>
                  ) : (
                    <span className="text-ink-4">✓</span>
                  )}
                </span>
                {/* The rule NAME is the headline; the answer is the subhead. A clean
                    check recedes to ink-3 — present, not shouting. */}
                <span className={c.count ? 'text-ink font-medium' : 'text-ink-3'}>{c.title}</span>
                <span className="text-ink-4 text-mini truncate">
                  {c.blocked ? "can't run yet" : c.count ? c.action : c.clean}
                </span>
                <span className="flex-1" />
                {c.count > 0 && <span className="num text-mini text-ink font-medium">{c.count}</span>}
              </button>

              {/* Blocked is a first-class state, not a failure. The engine refuses to
                  compute a number off data it does not have, and says exactly what
                  would unblock it — the same rule the conviction engine follows one
                  layer down. */}
              {c.blocked && <div className="px-2 pb-2 pl-7 text-mini text-ink-3 max-w-3xl">{c.blocked_reason}</div>}

              {isOpen && c.rows.length > 0 && (
                <div className="border-y border-line bg-ground-2">
                  {c.rows.map((r) => (
                    <div
                      key={`${c.key}-${r.id}`}
                      onClick={() => onOpen(r.founder_id)}
                      className="row pl-7 cursor-pointer"
                    >
                      <span className="row-primary w-48">{r.primary}</span>
                      <span className="flex-1 min-w-0 text-ink-2 truncate">{r.detail}</span>
                      {r.meta && <span className="row-meta w-56 text-right">{r.meta}</span>}
                    </div>
                  ))}
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
