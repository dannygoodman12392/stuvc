// ══════════════════════════════════════════════════════════════════════════
// Today — the screen Danny opens at 9am and works from all day.
//
// The old Home was a MENU: four buttons asking what you want. You only open a menu
// when you already know — which is why he never opened it. This screen tells him
// something instead: what expires.
//
// Lane order is decay order, and UNDECIDED leads on purpose. Danny: "Sometimes I
// just don't feel like following up... Or I'm waiting to think through if I believe
// in a company or not." The follow-up isn't blocked by discipline — it's blocked by
// an unformed view. Nagging a man to send an email he hasn't decided the content of
// is treating the symptom.
//
// Design, per tailwind.config.js: TWO colours. Accent = the one thing you can click.
// Danger = overdue. Everything else grey. Counts are typographic, never coloured —
// a green number tells you what to think before you've read it.
// ══════════════════════════════════════════════════════════════════════════
import { useState, useEffect, useCallback } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../utils/api';

const dayjs = (s) => (s ? new Date(s + (s.length === 10 ? 'T12:00:00' : '')) : null);
const daysUntil = (s) => {
  const d = dayjs(s);
  if (!d) return null;
  return Math.round((d - new Date()) / 86400000);
};
const ago = (s) => {
  const d = dayjs(s);
  if (!d) return '';
  const n = Math.round((new Date() - d) / 86400000);
  if (n <= 0) return 'today';
  if (n === 1) return 'yesterday';
  return `${n}d ago`;
};

function Lane({ label, count, children }) {
  if (!count) return null;
  return (
    <section className="mb-8">
      <h2 className="text-2xs font-semibold uppercase tracking-[0.12em] text-gray-400 mb-2">
        {label} <span className="tabular-nums text-gray-300">{count}</span>
      </h2>
      <div className="border-t border-gray-100">{children}</div>
    </section>
  );
}

function Row({ children, onDone, doneLabel = 'done', tone = 'default' }) {
  return (
    <div className="group flex items-start gap-3 py-3 border-b border-gray-100">
      <div className={`flex-1 min-w-0 ${tone === 'dim' ? 'text-gray-400' : ''}`}>{children}</div>
      {onDone && (
        <button
          onClick={onDone}
          className="opacity-0 group-hover:opacity-100 transition-opacity text-2xs text-gray-400 hover:text-accent whitespace-nowrap pt-0.5"
        >
          {doneLabel}
        </button>
      )}
    </div>
  );
}

// The line that produced a row. Every agent-made row carries its receipt.
function Quote({ children }) {
  if (!children) return null;
  return (
    <p className="text-xs text-gray-400 mt-1 leading-relaxed border-l-2 border-gray-200 pl-2 italic">
      “{String(children).slice(0, 180)}”
    </p>
  );
}

export default function Today() {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [newTask, setNewTask] = useState('');

  const load = useCallback(() => {
    api.getToday().then(setData).catch(() => setData(null)).finally(() => setLoading(false));
  }, []);
  useEffect(load, [load]);

  const addTask = async (e) => {
    e.preventDefault();
    const title = newTask.trim();
    if (!title) return;
    setNewTask('');
    await api.addTodayItem({ title });
    load();
  };

  if (loading) return <div className="p-8 text-sm text-gray-400">…</div>;
  if (!data) return <div className="p-8 text-sm text-gray-400">Couldn’t load Today.</div>;

  const total =
    data.undecided.length + data.i_owe.length + data.they_owe.length +
    data.predictions_due.length + data.items.length;

  return (
    <div className="max-w-3xl mx-auto px-6 py-10">
      <header className="mb-10 flex items-baseline justify-between">
        <h1 className="text-2xl font-semibold text-ink tracking-tight">
          {new Date().toLocaleDateString(undefined, { weekday: 'long' })}
        </h1>
        {/* The headline is DECIDED — never pipeline count. Danny told me he inflates
            pipeline to look busy; a metric he games is a metric I won't build. */}
        <div className="text-right">
          <div className="text-2xl font-semibold text-ink tabular-nums leading-none">
            {data.decided_this_week}
          </div>
          <div className="text-2xs uppercase tracking-wider text-gray-400 mt-1">decided this week</div>
        </div>
      </header>

      {total === 0 && (
        <div className="py-16 text-center">
          <p className="text-sm text-gray-500">Nothing expires today.</p>
          <p className="text-xs text-gray-400 mt-1">Close the laptop.</p>
        </div>
      )}

      {/* ── UNDECIDED — leads, because it's the real blocker ── */}
      <Lane label="Undecided" count={data.undecided.length}>
        {data.undecided.map((a) => (
          <Row key={a.assessment_id}>
            <div className="flex items-baseline gap-2">
              <Link to={`/assess/${a.assessment_id}`} className="text-sm font-medium text-ink hover:text-accent">
                {a.founder_company || a.founder_name || 'Untitled'}
              </Link>
              <span className="text-xs text-gray-400">{ago(a.created_at)}</span>
            </div>
            {/* Three genuinely different states, and the screen must not blur them:
                never scored by this engine · scored and held · scored. */}
            <p className="text-xs text-gray-500 mt-0.5">
              {a.predates_engine
                ? 'Scored under the old engine — re-run to get a read.'
                : a.conviction_band === 'indeterminate' || a.conviction_score == null
                  ? 'Not enough evidence to score — Stu is holding. Take the call.'
                  : `Stu says ${a.conviction_score} · ${a.conviction_band}. You haven’t made the call.`}
            </p>
          </Row>
        ))}
      </Lane>

      {/* ── I OWE — the Q10 ledger, his side ── */}
      <Lane label="You owe" count={data.i_owe.length}>
        {data.i_owe.map((c) => (
          <Row key={c.id} onDone={async () => { await api.closeCommitment(c.id, 'kept'); load(); }} doneLabel="done">
            <div className="flex items-baseline gap-2 flex-wrap">
              <span className="text-sm text-ink">{c.commitment}</span>
              <span className="text-xs text-gray-400">
                {c.founder_company || c.founder_name}
              </span>
              {c.overdue && <span className="text-2xs text-danger font-medium">overdue</span>}
              {c.due_at && !c.overdue && (
                <span className="text-2xs text-gray-400">{daysUntil(c.due_at)}d left</span>
              )}
            </div>
            <Quote>{c.quote}</Quote>
          </Row>
        ))}
      </Lane>

      {/* ── THEY OWE — the other half of the delta ── */}
      <Lane label="They owe you" count={data.they_owe.length}>
        {data.they_owe.map((c) => (
          <Row
            key={c.id}
            tone="dim"
            onDone={async () => { await api.closeCommitment(c.id, 'kept'); load(); }}
            doneLabel="they did it"
          >
            <div className="flex items-baseline gap-2 flex-wrap">
              <span className="text-sm text-gray-600">{c.commitment}</span>
              <span className="text-xs text-gray-400">{c.founder_company || c.founder_name}</span>
              <span className="text-2xs text-danger">
                {Math.abs(daysUntil(c.due_at))}d late
              </span>
            </div>
            <Quote>{c.quote}</Quote>
          </Row>
        ))}
      </Lane>

      {/* ── PREDICTIONS — the only thing here that compounds ── */}
      <Lane label="Predictions due" count={data.predictions_due.length}>
        {data.predictions_due.map((d) => (
          <Row key={d.id}>
            <div className="flex items-baseline gap-2 flex-wrap">
              <span className="text-sm text-ink">{d.founder_company || d.founder_name}</span>
              <span className="text-2xs text-gray-400">{daysUntil(d.resolve_by)}d</span>
            </div>
            <p className="text-xs text-gray-500 mt-0.5">{d.prediction}</p>
            <div className="flex gap-3 mt-1.5">
              {['right', 'wrong'].map((o) => (
                <button
                  key={o}
                  onClick={async () => { await api.resolveDecision(d.id, o); load(); }}
                  className="text-2xs text-gray-400 hover:text-accent"
                >
                  I was {o}
                </button>
              ))}
            </div>
          </Row>
        ))}
      </Lane>

      {/* ── HIS — the list is his; agents are guests ── */}
      <Lane label="Yours" count={data.items.length || 1}>
        {data.items.map((i) => (
          <Row
            key={i.id}
            onDone={async () => { await api.updateTodayItem(i.id, { completed: true }); load(); }}
          >
            <div className="flex items-baseline gap-2">
              <span className="text-sm text-ink">{i.title}</span>
              {i.origin === 'agent' && (
                <span className="text-2xs text-gray-300 uppercase tracking-wider">suggested</span>
              )}
            </div>
            {i.detail && <p className="text-xs text-gray-500 mt-0.5">{i.detail}</p>}
            <Quote>{i.quote}</Quote>
          </Row>
        ))}
        <form onSubmit={addTask} className="py-3">
          <input
            value={newTask}
            onChange={(e) => setNewTask(e.target.value)}
            placeholder="+ add"
            className="w-full text-sm bg-transparent border-none outline-none placeholder:text-gray-300 text-ink"
          />
        </form>
      </Lane>
    </div>
  );
}
