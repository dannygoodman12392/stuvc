import { useState, useEffect, useCallback } from 'react';
import { useParams, useNavigate, Link } from 'react-router-dom';
import { api } from '../utils/api';

// ══════════════════════════════════════════════════════════════════════════
// The Read — two columns that never merge.
//
// Danny: "This should run a comprehensive diligence check on the company
// (product, team, market, etc). It should cover all the bases to equip me to
// write a full-fledged memo on the company. In fact, it should be pretty close to
// a memo. And I should be able to add my own thoughts."
//
// And from his own analysis, the thing this page exists to fix:
//   "I don't bring anything to IC. It's really annoying... I should be the deal
//    leader. So I need the info to be able to take on that role."
//
// ── WHAT I DID NOT REBUILD ──
// The engine. conviction.js is 563 lines where every refusal is load-bearing and
// every comment records a real bug found empirically. The agents, the rubric-first
// ordering, temperature 0, the 8192 token ceiling, the retry wrapper — all of it
// stays. The nightly workup task also out-researches Stu (web access, cited URLs,
// a 4-lens panel) and this does not compete with it.
//
// What was missing was never the analysis. It was a PLACE FOR DANNY. The old page
// was 1,541 lines with literally zero <input> or <textarea> — and a section that
// rendered, on every assessment, forever:
//
//     Personal conviction
//     Unanswered
//     Your call. Stu does not assess this.
//
// An honest placeholder for the exact hole he keeps asking me to fill.
//
// ── BLIND-FIRST, AND WHY IT'S NOT A GIMMICK ──
// His call is entered BEFORE Stu's read unlocks. If he reads a 7.8 and then types
// his view, that isn't calibration — it's priming, and the disagreement record it
// produces is worthless because it can only ever measure how much he anchors.
//
// Portfolio Pattern Analysis names the blind spot this serves: "you pass well on
// markets, poorly on documentation — and the gap is exactly on your best founders
// ... you can't tell whether those were good passes or fear/laziness." The only
// cure is a dated view recorded BEFORE the outcome is known. That's this screen.
//
// The gap between his band and Stu's is the artifact. It's the only dataset here
// that compounds, and the only question no tool he can buy can answer — because
// answering it requires a record of what he thought before he knew.
// ══════════════════════════════════════════════════════════════════════════

const BANDS = [
  { key: 'anchor', label: 'Anchor-grade', hint: 'First call within a week' },
  { key: 'memo', label: 'Top-quartile', hint: 'Write a memo' },
  { key: 'monitor', label: 'Monitor', hint: 'Track the next data point' },
  { key: 'pass', label: 'Pass with respect', hint: 'Pass' },
];

export default function Read() {
  const { id } = useParams();
  const nav = useNavigate();
  const [a, setA] = useState(null);
  const [err, setErr] = useState(null);

  const load = useCallback(() => {
    api.getAssessment(id).then(setA).catch((e) => setErr(e.message));
  }, [id]);
  useEffect(load, [load]);

  if (err) return <div className="p-4 text-small text-danger">{err}</div>;
  if (!a) return <ReadSkeleton />;

  // Has Danny already ruled? If so the read is unlocked — the blind window has
  // closed and re-hiding it would just be theatre.
  const decided = !!a.decision;

  return (
    <div className="flex flex-col h-full">
      <div className="flex items-center gap-2 px-3 h-8 border-b border-line-2 bg-ground flex-shrink-0">
        <button onClick={() => nav('/pipeline')} className="text-mini text-ink-4 hover:text-ink">← Pipeline</button>
        <span className="text-ink-4">/</span>
        {a.founder_id ? (
          <Link to={`/founders/${a.founder_id}`} className="text-small font-semibold text-ink hover:text-accent">
            {a.founder_company || a.founder_name}
          </Link>
        ) : (
          <span className="text-small font-semibold text-ink">{a.founder_company || a.founder_name}</span>
        )}
        <span className="text-mini text-ink-4">{String(a.created_at).slice(0, 10)}</span>
        <div className="flex-1" />
        <Status a={a} />
      </div>

      <div className="grid grid-cols-2 flex-1 min-h-0 divide-x divide-line-2">
        <YourCall assessment={a} onDecided={load} />
        <TheRead assessment={a} locked={!decided} />
      </div>
    </div>
  );
}

// ══════════════════════════════════════════════════════════════════════════
// LEFT — YOUR CALL. His column. Stu never writes here.
// ══════════════════════════════════════════════════════════════════════════
function YourCall({ assessment: a, onDecided }) {
  const d = a.decision;
  const [band, setBand] = useState(d?.band || '');
  const [rationale, setRationale] = useState(d?.rationale || '');
  const [prediction, setPrediction] = useState(d?.prediction || '');
  const [resolveBy, setResolveBy] = useState(d?.resolve_by || defaultResolveBy());
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState(null);

  async function submit() {
    setError(null);
    setSaving(true);
    try {
      await api.createDecision({
        founder_id: a.founder_id,
        assessment_id: a.id,
        band, rationale, prediction, resolve_by: resolveBy,
      });
      onDecided();
    } catch (e) {
      // The server refuses a decision with no prediction and says why. Surface
      // its sentence rather than a generic failure — the refusal IS the teaching.
      setError(e.detail ? `${e.message} ${e.detail}` : e.message);
    } finally {
      setSaving(false);
    }
  }

  if (d) return <DecisionMade decision={d} stuBand={a.conviction_band} stuScore={a.conviction_score} />;

  return (
    <div className="overflow-y-auto p-4 space-y-5">
      <div>
        <h2 className="text-large font-semibold text-ink">Your call</h2>
        <p className="text-small text-ink-3 mt-1 max-w-md leading-relaxed">
          Before you read Stu's. You've seen the deck and taken the call — that view is the
          one worth recording, and it stops being yours the moment you read a number.
        </p>
      </div>

      {/* The rubric's own separate gate, quoted from Brain/02 Frameworks:
          "We don't invest in founders we don't want to be around, or whose vision
          doesn't resonate." It is deliberately not part of the quality score. */}
      <div className="rounded border border-line-2 bg-ground-2 px-3 py-2">
        <p className="text-small text-ink-2 leading-relaxed">
          Would you want to work with them for ten years — and would you take this call again
          if there were no deal in it?
        </p>
      </div>

      <div>
        <label className="label">Your band</label>
        <div className="space-y-1">
          {BANDS.map((b) => (
            <button
              key={b.key}
              onClick={() => setBand(b.key)}
              className={`w-full flex items-baseline gap-2 px-2 h-row rounded text-left transition ${
                band === b.key ? 'bg-ground-4 text-ink' : 'text-ink-2 hover:bg-ground-3'
              }`}
            >
              <span className="text-small font-medium w-32">{b.label}</span>
              <span className="text-mini text-ink-4">{b.hint}</span>
            </button>
          ))}
        </div>
      </div>

      <div>
        <label className="label">Why — one line</label>
        <textarea
          className="textarea"
          rows={3}
          placeholder="What actually decided it?"
          value={rationale}
          onChange={(e) => setRationale(e.target.value)}
        />
      </div>

      {/* ── The required prediction. This is the whole design of the metric. ──
          A pass without a dated checkable claim is a reflex, not a decision. His
          most common kill is a ten-second "cool but indefensible", and a bare
          pass=+1 would pay him to fire it faster. In 12 months the prediction is
          the only thing that can tell a good pass from a fast one. */}
      <div>
        <label className="label">A dated, checkable claim</label>
        <textarea
          className="textarea"
          rows={2}
          placeholder="Something that will be provably right or wrong. Not &quot;they'll do well&quot; — &quot;they'll have 3 paying customers by October.&quot;"
          value={prediction}
          onChange={(e) => setPrediction(e.target.value)}
        />
        <div className="flex items-center gap-2 mt-2">
          <span className="text-mini text-ink-4">We find out on</span>
          <input
            type="date"
            className="input w-40"
            value={resolveBy}
            onChange={(e) => setResolveBy(e.target.value)}
          />
        </div>
      </div>

      {error && <p className="text-small text-danger leading-relaxed">{error}</p>}

      <button
        onClick={submit}
        disabled={saving || !band}
        className="btn-primary w-full justify-center"
      >
        {saving ? 'Recording…' : 'Record my call and show me Stu’s'}
      </button>
      <p className="text-micro text-ink-4">
        Recorded first, so the disagreement means something. You can't un-see a score.
      </p>
    </div>
  );
}

function DecisionMade({ decision: d, stuBand, stuScore }) {
  const disagreed = stuBand && stuBand !== 'indeterminate' && stuBand !== d.band;
  return (
    <div className="overflow-y-auto p-4 space-y-5">
      <div className="flex items-baseline gap-2">
        <h2 className="text-large font-semibold text-ink">Your call</h2>
        <span className="text-mini text-ink-4">{String(d.decided_at).slice(0, 10)}</span>
      </div>

      <div>
        <div className={`band band-${d.band} text-large`}>{labelFor(d.band)}</div>
        {d.rationale && <p className="text-regular text-ink mt-2 leading-relaxed">{d.rationale}</p>}
      </div>

      {/* The gap. The only artifact here that compounds. */}
      {disagreed && (
        <div className="rounded border border-line-2 px-3 py-2">
          <div className="text-micro font-semibold uppercase text-ink-4 mb-1">You and Stu disagree</div>
          <p className="text-small text-ink-2 leading-relaxed">
            You said <span className="font-medium text-ink">{labelFor(d.band)}</span>. Stu read{' '}
            <span className="font-medium text-ink">{labelFor(stuBand)}</span>
            {stuScore != null && <span className="num"> ({stuScore})</span>}.
            {' '}This is the row worth keeping — in a year it's the only thing that can say who was right.
          </p>
        </div>
      )}

      <div>
        <div className="text-micro font-semibold uppercase text-ink-4 mb-1">Your prediction</div>
        <p className="text-regular text-ink leading-relaxed">{d.prediction}</p>
        <p className="text-mini text-ink-3 mt-1">
          We find out on <span className="num">{d.resolve_by}</span>
          {d.outcome && d.outcome !== 'unresolved' && (
            <span className="text-ink"> · you were {d.outcome}</span>
          )}
        </p>
      </div>
    </div>
  );
}

// ══════════════════════════════════════════════════════════════════════════
// RIGHT — THE READ. Stu's. Locked until Danny has ruled.
// ══════════════════════════════════════════════════════════════════════════
function TheRead({ assessment: a, locked }) {
  if (locked) {
    return (
      <div className="flex items-center justify-center p-8">
        <div className="max-w-xs text-center">
          <p className="text-small text-ink-3 leading-relaxed">
            Stu's read is here. It stays covered until you've recorded yours — otherwise
            the disagreement measures how much you anchor, not who was right.
          </p>
        </div>
      </div>
    );
  }

  const conv = parse(a.conviction_output);

  // ── Three states for the SCORE. The analysis renders regardless. ──
  //
  // "No score" means one of two completely different things and the screen must
  // never conflate them: either the engine RAN and honestly held for lack of
  // evidence, or the row predates the engine and was never scored at all. Saying
  // "not enough evidence" about a run that never happened is the same lie this
  // rebuild exists to remove.
  //
  // But my first pass returned EARLY on both, which threw away the whole read —
  // and 14 of Danny's 18 assessments predate the engine. Those rows have a
  // complete team/product/market/bear analysis and a defensibility section; only
  // the conviction NUMBER is absent. Hiding four months of real work because one
  // field is null is its own kind of dishonesty: it renders "we know nothing"
  // when the truth is "we know a lot and haven't scored it."
  //
  // So the score header is conditional. Everything below it is not.
  return (
    <div className="overflow-y-auto p-4 space-y-5">
      {!a.conviction_output ? (
        <PredatesEngine a={a} />
      ) : !conv?.determinate ? (
        <Held conv={conv} a={a} />
      ) : (
        <Verdict conv={conv} />
      )}

      {/* Above the movements, deliberately. "Cool but indefensible" is his most
          common kill and the fastest one to fire — it should be the first thing
          he can check the machine against, not something he finds at memo time. */}
      <Defensibility parts={a.defensibility} />
      {conv?.determinate && <Movements conv={conv} />}
      {conv?.determinate && <Docks conv={conv} />}
      <Memo a={a} />
      {conv?.calibration && (
        <p className="text-micro text-ink-4 leading-relaxed border-t border-line pt-3">{conv.calibration}</p>
      )}
    </div>
  );
}

function Defensibility({ parts }) {
  if (!parts?.length) return null;
  return (
    <div className="border-t border-line pt-3">
      <div className="text-micro font-semibold uppercase text-ink-4 mb-2">Defensibility</div>
      <div className="space-y-2">
        {parts.map((p) => (
          <div key={p.label}>
            <div className="text-mini text-ink-4">{p.label}</div>
            <p className="text-small text-ink-2 leading-relaxed whitespace-pre-wrap">{p.body}</p>
          </div>
        ))}
      </div>
    </div>
  );
}

function Verdict({ conv }) {
  return (
    <div>
      <div className="flex items-baseline gap-3">
        <span className="text-display num text-ink">{conv.score}</span>
        <div>
          <div className={`band band-${conv.band.key} text-regular`}>{conv.band.label}</div>
          <div className="text-mini text-ink-3">{conv.band.action}</div>
        </div>
      </div>
      <p className="text-mini text-ink-3 mt-2">
        Evidence: {conv.rung_label}
        {conv.gate_applied && ' · capped — the load-bearing movements did not clear'}
      </p>
    </div>
  );
}

function Movements({ conv }) {
  return (
    <div>
      <div className="text-micro font-semibold uppercase text-ink-4 mb-2">The four movements</div>
      <div className="-mx-2">
        {(conv.movements || []).map((m) => (
          <div key={m.key} className="row px-2">
            <span className="flex-1 min-w-0">
              <span className={m.load_bearing ? 'text-ink font-medium' : 'text-ink-2'}>{m.label}</span>
              {m.load_bearing && <span className="text-micro text-ink-4 ml-2">sets the score</span>}
            </span>
            <span className="num w-10 text-right">
              {m.value == null ? <span className="text-ink-4">—</span> : <span className="text-ink">{m.value}</span>}
            </span>
          </div>
        ))}
      </div>
      {conv.unscorable?.length > 0 && (
        <p className="text-mini text-ink-3 mt-2 leading-relaxed">
          {conv.unscorable.length} unscored — the engine abstains rather than defaulting to 5.
        </p>
      )}
    </div>
  );
}

function Docks({ conv }) {
  const docks = (conv.docks || []).filter((d) => d.applied);
  if (!docks.length) return null;
  return (
    <div>
      <div className="text-micro font-semibold uppercase text-ink-4 mb-2">Docks</div>
      {docks.map((d, i) => (
        <div key={i} className="flex items-baseline gap-2 py-1">
          <span className="num text-ink w-10">{d.amount}</span>
          <span className="text-small text-ink-2 flex-1 leading-relaxed">{d.reason}</span>
        </div>
      ))}
      {conv.dock_capped && <p className="text-micro text-ink-4 mt-1">Capped — docks can't overrule two bands of evidence.</p>}
    </div>
  );
}

// The 7-M. Already built as a pure formatter over the agent outputs — no LLM
// call, no second opinion, no sampling. Danny asked for "pretty close to a memo"
// and this is it; it was just buried below the fold.
function Memo({ a }) {
  const [open, setOpen] = useState(false);
  return (
    <div className="border-t border-line pt-3">
      <button onClick={() => setOpen(!open)} className="text-small font-medium text-ink hover:text-accent">
        {open ? '▾' : '▸'} Deal memo — 7-M
      </button>
      {open && <MemoBody a={a} />}
    </div>
  );
}

function PredatesEngine({ a }) {
  return (
    <div>
      <div className="text-large font-semibold text-ink">No score</div>
      <p className="text-small text-ink-2 leading-relaxed max-w-md mt-1">
        This read ran on <span className="num">{String(a.created_at).slice(0, 10)}</span>, before the
        conviction engine existed. There is no score — not because the evidence was thin, but because
        nothing scored it. The analysis below is real; the number was never computed.
      </p>
      <Link to={`/assess?founder=${a.founder_id}`} className="btn-secondary mt-2 inline-flex">
        Re-run to score it
      </Link>
    </div>
  );
}

function Held({ conv, a }) {
  return (
    <div className="p-4 space-y-3">
      <div>
        <div className="text-large font-semibold text-ink">No score</div>
        <p className="text-small text-ink-2 mt-1 leading-relaxed max-w-md">
          {conv?.reason ||
            'The load-bearing movements — earned insight and execution velocity — could not be scored from these inputs.'}
        </p>
        <p className="text-mini text-ink-3 mt-2">
          Evidence: {conv?.rung_label || 'none'}. Below "observed in conversation" there is no score —
          there's a question list. That refusal is the product.
        </p>
      </div>
      {conv?.missing_load_bearing?.length > 0 && (
        <div>
          <div className="text-micro font-semibold uppercase text-ink-4 mb-1">What's missing</div>
          {conv.missing_load_bearing.map((m) => (
            <div key={m} className="text-small text-ink-2">{m}</div>
          ))}
        </div>
      )}
    </div>
  );
}

function Status({ a }) {
  if (a.status === 'running' || a.status === 'processing_inputs' || a.status === 'synthesizing')
    return <span className="text-mini text-ink-3">Reading…</span>;
  if (a.status === 'error') return <span className="text-mini text-danger">Failed</span>;
  if (a.status === 'partial') return <span className="text-mini text-ink-3">Partial — some agents failed</span>;
  return null;
}

const parse = (s) => { try { return typeof s === 'string' ? JSON.parse(s) : s; } catch { return null; } };
const labelFor = (k) => BANDS.find((b) => b.key === k)?.label || k;

// 90 days. Long enough that a real thing can happen, short enough that he'll
// still care about the answer.
function defaultResolveBy() {
  const d = new Date();
  d.setDate(d.getDate() + 90);
  return d.toISOString().slice(0, 10);
}

function MemoBody({ a }) {
  const memo = a.memo_7m;
  if (!memo?.length) return <p className="text-mini text-ink-4 mt-2">No memo — the depth agents didn't complete.</p>;
  return (
    <div className="mt-3 space-y-4">
      {memo.map((s) => (
        <div key={s.key}>
          <div className="text-micro font-semibold uppercase text-ink-4 mb-1">{s.title}</div>
          {s.note && <p className="text-mini text-ink-4 mb-1 leading-relaxed">{s.note}</p>}
          <div className="text-small text-ink-2 whitespace-pre-wrap leading-relaxed">{s.body}</div>
        </div>
      ))}
    </div>
  );
}

function ReadSkeleton() {
  return (
    <div className="grid grid-cols-2 h-full divide-x divide-line-2">
      {[0, 1].map((c) => (
        <div key={c} className="p-4 space-y-2">
          {Array.from({ length: 6 }).map((_, i) => (
            <div key={i} className="h-2 bg-ground-3 rounded-sm" style={{ width: `${[45, 80, 60, 70, 40, 65][i]}%` }} />
          ))}
        </div>
      ))}
    </div>
  );
}
