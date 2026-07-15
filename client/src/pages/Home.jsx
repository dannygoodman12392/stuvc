import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { api } from '../utils/api';

// ══════════════════════════════════════════════════════════════════════════
// Home — Today's Tasks, and the state of the funnel.
//
// Danny, 2026-07-15: "What if there was a home screen with 'Today's Tasks' and a
// dashboard covering pipeline stats. And then there is a separate Sourcing
// function, and a Pipeline function."
//
// The Home this replaces was four task buttons — a menu, which you only open
// when you already know what you want, which is why it never got opened. This
// one tells you something instead of asking you something.
//
// ── TWO KINDS OF TASK, AND THE AGENTS ARE GUESTS ──
// Danny: "It is my to-do list — I should be able to add/modify/delete/check-off
// my own ideas in addition to what your agents suggest."
//
// So there are two lists that never merge. What Stu noticed is COMPUTED from
// pipeline state, never stored, and can't be ticked off — you fix the underlying
// thing and it goes away by itself. What Danny wrote is his: his order, his
// wording, deletable. His text is ink; the machine's is ink-3. No badges, no
// sparkles — that's the whole provenance system and it's enough.
//
// ── WHY THE DASHBOARD SHOWS NO PIPELINE TOTAL ──
// He asked for stats. He also said "I want to inflate my pipeline numbers." So
// this shows funnel STATE (where things are, which channels produce) and exactly
// one progress number: DECIDED. Nothing on this screen goes up when he adds a name.
// ══════════════════════════════════════════════════════════════════════════

export default function Home() {
  const nav = useNavigate();
  const [attention, setAttention] = useState(null);
  const [stats, setStats] = useState(null);
  const [today, setToday] = useState(null);
  const [draft, setDraft] = useState('');
  const [err, setErr] = useState(null);

  useEffect(() => {
    api.getAttention().then(setAttention).catch((e) => setErr(e.message));
    api.getPipelineStats().then(setStats).catch(() => {});
    api.getToday().then(setToday).catch(() => {});
  }, []);

  async function addItem(e) {
    e.preventDefault();
    const title = draft.trim();
    if (!title) return;
    setDraft('');
    try {
      const item = await api.addTodayItem({ title, lane: 'mine' });
      setToday((t) => ({ ...t, items: [...(t?.items || []), item] }));
    } catch (e2) {
      setErr(e2.message);
      setDraft(title); // never silently eat what he typed — the old add box did
    }
  }

  async function toggleItem(item) {
    const done = !item.completed_at;
    setToday((t) => ({
      ...t,
      items: t.items.map((i) => (i.id === item.id ? { ...i, completed_at: done ? 'now' : null } : i)),
    }));
    try { await api.updateTodayItem(item.id, { completed: done }); } catch { /* optimistic */ }
  }

  async function removeItem(item) {
    setToday((t) => ({ ...t, items: t.items.filter((i) => i.id !== item.id) }));
    try { await api.deleteTodayItem(item.id); } catch { /* optimistic */ }
  }

  const items = today?.items || [];

  return (
    <div className="h-full overflow-y-auto">
      <div className="px-4 py-4 max-w-[1100px]">
        {err && <div className="text-small text-danger mb-3">{err}</div>}

        <div className="flex items-baseline gap-2 mb-2">
          <h1 className="text-large font-semibold text-ink">Today</h1>
          {attention && (
            <span className="text-mini text-ink-3">
              {attention.needs_attention === 0
                ? 'nothing needs you'
                : `${attention.needs_attention} ${attention.needs_attention === 1 ? 'company needs' : 'companies need'} you`}
            </span>
          )}
        </div>

        <div className="border border-line-2 rounded-md bg-ground mb-4">
          <div className="px-3 h-6 flex items-center border-b border-line bg-ground-3">
            <span className="text-micro font-semibold uppercase text-ink-4">What Stu noticed</span>
          </div>
          {!attention ? (
            Array.from({ length: 3 }).map((_, i) => (
              <div key={i} className="row px-3"><span className="block h-2 w-64 bg-ground-3 rounded-sm" /></div>
            ))
          ) : (
            <Checks data={attention} nav={nav} />
          )}
        </div>

        <div className="border border-line-2 rounded-md bg-ground mb-4">
          <div className="px-3 h-6 flex items-center border-b border-line bg-ground-3">
            <span className="text-micro font-semibold uppercase text-ink-4">Yours</span>
            <div className="flex-1" />
            <span className="num text-micro text-ink-4">{items.filter((i) => !i.completed_at).length}</span>
          </div>

          {items.map((item) => (
            <div key={item.id} className="row px-3 group">
              <button
                onClick={() => toggleItem(item)}
                className={`w-3 h-3 rounded-sm border mr-2 flex-none transition ${
                  item.completed_at ? 'bg-ink border-ink' : 'border-line-3 hover:border-ink-3'
                }`}
                aria-label={item.completed_at ? 'Mark undone' : 'Mark done'}
              />
              <span className={`flex-1 min-w-0 truncate ${item.completed_at ? 'text-ink-4 line-through' : 'text-ink'}`}>
                {item.title}
              </span>
              {/* An agent row says where it came from, quietly. It is still HIS row —
                  he can delete it, and the tombstone stops the next nightly run
                  resurrecting it, which is the most common way this pattern dies. */}
              {item.origin === 'agent' && <span className="text-mini text-ink-4 mr-2">from a call</span>}
              <button
                onClick={() => removeItem(item)}
                className="text-mini text-ink-4 hover:text-danger opacity-0 group-hover:opacity-100 transition"
              >
                Delete
              </button>
            </div>
          ))}

          <form onSubmit={addItem} className="flex items-center h-row px-3 border-t border-line">
            <span className="w-3 mr-2 text-ink-4 text-center leading-none">+</span>
            <input
              className="flex-1 bg-transparent border-0 outline-none text-small text-ink placeholder-ink-4"
              placeholder="Add something…"
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
            />
          </form>
        </div>

        <Dashboard stats={stats} nav={nav} />
      </div>
    </div>
  );
}

// Every check renders daily, including when clean — the reason Permute's version
// is trustworthy is that "✓ no overdue follow-ups" sits next to the amber one. A
// list that only appears when something is wrong is indistinguishable from a list
// that is broken. Silence has to mean "I looked."
function Checks({ data, nav }) {
  const [open, setOpen] = useState(null);
  const [showClean, setShowClean] = useState(false);
  const clean = data.checks.filter((c) => !c.count && !c.blocked);
  const live = data.checks.filter((c) => c.count || c.blocked);
  const shown = showClean ? data.checks : live;

  return (
    <>
      {shown.map((c) => (
        <div key={c.key}>
          <button
            onClick={() => setOpen(open === c.key ? null : c.key)}
            disabled={!c.count}
            className={`w-full flex items-center gap-2 h-row px-3 text-small text-left transition ${
              c.count ? 'hover:bg-ground-3 cursor-pointer' : 'cursor-default'
            }`}
          >
            <span className="w-3 text-center text-mini flex-none">
              {c.blocked ? <span className="text-ink-4">·</span>
                : c.count ? <span className="text-attention">▲</span>
                : <span className="text-ink-4">✓</span>}
            </span>
            <span className={`flex-none ${c.count ? 'text-ink font-medium' : 'text-ink-3'}`}>{c.title}</span>
            <span className="text-ink-4 text-mini truncate">
              {c.blocked ? "can't run yet" : c.count ? c.action : c.clean}
            </span>
            <span className="flex-1" />
            {c.count > 0 && <span className="num text-mini text-ink font-medium">{c.count}</span>}
          </button>

          {/* Blocked is a first-class state, not a failure. The engine refuses to
              compute a number off data it doesn't have, and says what would fix it. */}
          {c.blocked && <div className="px-3 pb-2 pl-8 text-mini text-ink-3 max-w-3xl">{c.blocked_reason}</div>}

          {open === c.key && c.rows.length > 0 && (
            <div className="border-y border-line bg-ground-2 max-h-64 overflow-y-auto">
              {c.rows.map((r) => (
                <div
                  key={`${c.key}-${r.id}`}
                  onClick={() => r.founder_id && nav(`/founders/${r.founder_id}`)}
                  className="row px-3 pl-8 cursor-pointer"
                >
                  <span className="row-primary w-44 flex-none">{r.primary}</span>
                  <span className="flex-1 min-w-0 text-ink-2 truncate">{r.detail}</span>
                  {r.meta && <span className="row-meta w-52 text-right">{r.meta}</span>}
                </div>
              ))}
            </div>
          )}
        </div>
      ))}
      {clean.length > 0 && (
        <button
          onClick={() => setShowClean((s) => !s)}
          className="w-full flex items-center gap-2 h-6 px-3 text-mini text-ink-4 hover:text-ink-2 transition border-t border-line"
        >
          <span className="w-3 text-center">✓</span>
          {showClean ? 'Hide the clean ones' : `${clean.length} checks clean`}
        </button>
      )}
    </>
  );
}

function Dashboard({ stats, nav }) {
  if (!stats) return null;
  const F = stats.funnel;

  // No total, deliberately. Every stage is a link to the same board, filtered —
  // a dashboard whose numbers aren't clickable is a poster.
  const stages = [
    { k: 'found', label: 'Found', n: F.found },
    { k: 'met', label: 'Met', n: F.met },
    { k: 'assessed', label: 'Assessed', n: F.assessed },
    { k: 'decided', label: 'Decided', n: F.decided },
    { k: 'invested', label: 'Invested', n: F.invested },
  ];
  const max = Math.max(...stats.by_source.map((s) => s.n), 1);

  return (
    <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
      <div className="border border-line-2 rounded-md bg-ground lg:col-span-2">
        <div className="px-3 h-6 flex items-center border-b border-line bg-ground-3">
          <span className="text-micro font-semibold uppercase text-ink-4">Where things are</span>
          <div className="flex-1" />
          <button className="text-micro text-accent" onClick={() => nav('/pipeline')}>Open the pipeline →</button>
        </div>
        <div className="flex">
          {stages.map((s) => (
            <button
              key={s.k}
              onClick={() => nav(`/pipeline?stage=${s.k}`)}
              className="flex-1 px-3 py-3 text-left border-r border-line last:border-r-0 hover:bg-ground-3 transition"
            >
              <div className="num text-display text-ink leading-none">{s.n}</div>
              <div className="text-mini text-ink-3 mt-1">{s.label}</div>
            </button>
          ))}
        </div>
      </div>

      <div className="border border-line-2 rounded-md bg-ground">
        <div className="px-3 h-6 flex items-center border-b border-line bg-ground-3">
          <span className="text-micro font-semibold uppercase text-ink-4">Decided this week</span>
        </div>
        <div className="px-3 py-3">
          {/* The ONLY progress metric in the product. Its increment requires a dated
              falsifiable prediction — a bare pass=+1 would pay him to fire his
              ten-second "cool but indefensible" reflex faster. */}
          <div className="num text-display text-ink leading-none">{stats.decided_this_week}</div>
          <div className="text-mini text-ink-3 mt-1">
            {stats.calibration.decisions === 0
              ? 'No decisions on file yet'
              : stats.calibration.right_when_disagreed == null
              ? `${stats.calibration.disagreed} disagreements with Stu, none resolved yet`
              : `Right ${stats.calibration.right_when_disagreed}% of the time you disagreed with Stu`}
          </div>
        </div>
      </div>

      <div className="border border-line-2 rounded-md bg-ground lg:col-span-2">
        <div className="px-3 h-6 flex items-center border-b border-line bg-ground-3">
          {/* His own Permute spec: "Count of founders by Source, so I can see which
              channel is producing volume." */}
          <span className="text-micro font-semibold uppercase text-ink-4">Which channels produce</span>
        </div>
        <div className="py-1">
          {stats.by_source.map((s) => (
            <div key={s.source} className="flex items-center gap-2 h-6 px-3 text-mini">
              <span className="w-40 truncate text-ink-2">{s.source}</span>
              {/* The bar is ink, not a hue. Color would mean state; this is volume. */}
              <span className="flex-1 h-1 bg-ground-3 rounded-sm overflow-hidden">
                <span className="block h-full bg-ink-4" style={{ width: `${(s.n / max) * 100}%` }} />
              </span>
              <span className="num text-ink-3 w-8 text-right">{s.n}</span>
            </div>
          ))}
        </div>
      </div>

      {/* self-start, or the grid stretches this to match the taller card beside it
          and leaves a dead white block above the header. */}
      <button
        onClick={() => nav('/sourcing')}
        className="border border-line-2 rounded-md bg-ground text-left hover:bg-ground-3 transition self-start"
      >
        <div className="px-3 h-6 flex items-center border-b border-line bg-ground-3">
          <span className="text-micro font-semibold uppercase text-ink-4">Waiting in sourcing</span>
        </div>
        <div className="px-3 py-3">
          <div className="num text-display text-ink leading-none">{stats.inbox_waiting}</div>
          <div className="text-mini text-ink-3 mt-1">
            {stats.inbox_waiting === 0 ? 'Inbox is clear' : 'with a verified Illinois tie'}
          </div>
        </div>
      </button>
    </div>
  );
}
