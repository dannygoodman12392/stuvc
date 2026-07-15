import { useState, useEffect, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import { api } from '../utils/api';

// ══════════════════════════════════════════════════════════════════════════
// Sourcing — the inbox. Study and triage people you have never met.
//
// Danny, 2026-07-15, after I stacked this on top of the pipeline board:
//   "I wonder if we're conflating two actions here: 1) I need an inbox to study
//    and triage new founders (true sourcing) and 2) the ability to manage a
//    pipeline (like a kanban). But right now, this screen is a jumble."
//
// He's right, and the mistake is worth recording so it isn't made a fourth time:
// the insight that Stu has ONE object moving through stages is about the DATA,
// not the SCREENS. Affinity and Attio both have one record substrate AND separate
// surfaces. Triaging a stranger and managing a company you're tracking are
// different jobs in different mental modes — one is fast and mostly rejecting,
// the other is slow and mostly accumulating. Stacking them made both worse.
//
// So: one substrate, three surfaces. The record is still the same record — Track
// promotes it in a single transaction that keeps the source chain — but this
// screen only ever does one thing.
//
// ── THE JOB HERE ──
// Read a stranger, decide in about two seconds, move on. Everything on the row
// exists to serve that: WHO they are, WHY they're in front of you (the signal),
// and WHAT ties them to Illinois. Nothing else earns its width.
//
// Harmonic's lesson: the alert is the product and the search bar is its config
// UI. This should fill overnight and be waiting.
// ══════════════════════════════════════════════════════════════════════════

// The YC connector builds `headline` as role + bio, and the bio usually opens with
// the same role — so rows read "Founder Founder at Floracene" and "Co-Founder &
// CTO Co-Founder & CTO at Rise Reforming". A phrase printed twice carries the
// information once and costs the column its first 120px.
//
// Strips ONLY an exact duplicated opening phrase. Nothing else.
//
// I tried also dropping the leading role, and it produced rows starting
// "at Floracene…" and "prev @ two sigma…" — sentences beginning mid-clause, which
// reads worse than the noise it removed. "Founder at Floracene (YC S26)" is fine.
// Cosmetic only: the raw headline is on hover, and nothing here feeds the tie gate.
function signalOf(r) {
  const raw = (r.headline || r.company_one_liner || '').trim();
  const dup = raw.match(/^(.{3,40}?)\s+\1(?=\s|\b)/i);
  return dup ? raw.slice(dup[1].length).trim() : raw;
}

const parseArr = (s) => { try { const v = JSON.parse(s || '[]'); return Array.isArray(v) ? v : []; } catch { return []; } };

export default function Sourcing() {
  const nav = useNavigate();
  const [data, setData] = useState(null);
  const [scope, setScope] = useState('pipeline');
  const [q, setQ] = useState('');
  const [busy, setBusy] = useState(null);
  const [cursor, setCursor] = useState(0);
  const [err, setErr] = useState(null);
  const [justTracked, setJustTracked] = useState(null);
  // The study half of the job. Danny on the original inbox: "I liked it as an
  // inbox where I could vote Pass/Add to Pipeline or jump off to see their
  // LinkedIn. I could see a bit about the founder. That paradigm worked well."
  // I'd stripped it to a flat table with no way to look closer, which turned a
  // reading surface into a guessing one.
  const [openId, setOpenId] = useState(null);

  useEffect(() => {
    let dead = false;
    setData(null);
    api
      .getPipelineInbox({ scope })
      .then((d) => !dead && setData(d))
      .catch((e) => !dead && setErr(e.message));
    return () => { dead = true; };
  }, [scope]);

  const rows = useMemo(() => {
    if (!data) return [];
    if (!q) return data.rows;
    const n = q.toLowerCase();
    return data.rows.filter(
      (r) =>
        (r.name || '').toLowerCase().includes(n) ||
        (r.company || '').toLowerCase().includes(n) ||
        (r.headline || '').toLowerCase().includes(n)
    );
  }, [data, q]);

  async function triage(row, action) {
    setBusy(row.id);
    const before = data;
    setData((s) => ({ ...s, rows: s.rows.filter((r) => r.id !== row.id), total: s.total - 1 }));
    try {
      if (action === 'approve') {
        const founder = await api.approveSourced(row.id);
        // The promotion IS the connective tissue: one transaction writes the
        // company card and both direction pointers, so six months from now
        // "how did I find them?" is still answerable. Confirm it by name, with a
        // link — a triage action that vanishes silently feels like a delete.
        setJustTracked({ name: row.name, company: row.company, id: founder?.id });
        setTimeout(() => setJustTracked((j) => (j && j.id === founder?.id ? null : j)), 6000);
      } else if (action === 'dismiss') await api.dismissSourced(row.id);
      else if (action === 'hide') await api.hideForeverSourced(row.id);
    } catch (e) {
      setData(before);
      setErr(e.message);
    } finally {
      setBusy(null);
    }
  }

  // Triage is a keyboard job. j/k to read, t/x to decide. Danny should be able to
  // clear this list without touching the mouse.
  useEffect(() => {
    function onKey(e) {
      if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA') return;
      const row = rows[cursor];
      if (e.key === 'j') { setCursor((c) => Math.min(c + 1, rows.length - 1)); if (openId) setOpenId(rows[Math.min(cursor + 1, rows.length - 1)]?.id); }
      else if (e.key === 'k') { setCursor((c) => Math.max(c - 1, 0)); if (openId) setOpenId(rows[Math.max(cursor - 1, 0)]?.id); }
      else if (e.key === 't' && row) triage(row, 'approve');
      else if (e.key === 'x' && row) triage(row, 'dismiss');
      else if (e.key === 'Enter' && row) setOpenId(openId === row.id ? null : row.id);
      else if (e.key === 'Escape') setOpenId(null);
      else return;
      e.preventDefault();
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [rows, cursor, openId]); // eslint-disable-line react-hooks/exhaustive-deps

  const open = rows.find((r) => r.id === openId) || null;

  if (err) return <div className="p-4 text-small text-danger">{err}</div>;

  return (
    <div className="flex flex-col h-full">
      <div className="flex items-center gap-2 px-3 h-8 border-b border-line-2 bg-ground flex-shrink-0">
        <span className="text-small font-semibold text-ink">Sourcing</span>
        <span className="text-mini text-ink-4">
          {scope === 'pipeline' ? 'verified Illinois tie' : 'no Illinois tie — national frontier'}
        </span>
        <div className="flex-1" />
        <input
          className="input w-48 border-0 bg-transparent focus:ring-0 px-0"
          placeholder="Filter…"
          value={q}
          onChange={(e) => { setQ(e.target.value); setCursor(0); }}
        />
        <div className="flex items-center gap-px">
          {[
            { k: 'pipeline', label: 'Illinois', n: data?.total },
            { k: 'watchlist', label: 'Frontier Watch', n: data?.watchlist },
          ].map((s) => (
            <button
              key={s.k}
              onClick={() => { setScope(s.k); setCursor(0); }}
              className={`px-2 h-6 rounded text-mini font-medium transition ${
                scope === s.k ? 'bg-ground-4 text-ink' : 'text-ink-3 hover:text-ink hover:bg-ground-3'
              }`}
            >
              {s.label}
              {s.n != null && <span className="num text-ink-4 ml-1">{s.n}</span>}
            </button>
          ))}
        </div>
      </div>

      {justTracked && (
        <div className="flex items-center gap-2 px-3 h-row border-b border-line bg-accent-soft text-small flex-shrink-0">
          <span className="text-ink">
            <span className="font-medium">{justTracked.company || justTracked.name}</span> is on the pipeline.
          </span>
          <button className="text-accent font-medium" onClick={() => nav(`/founders/${justTracked.id}`)}>
            Open the card →
          </button>
          <div className="flex-1" />
          <button className="text-ink-4 hover:text-ink-2" onClick={() => setJustTracked(null)}>Dismiss</button>
        </div>
      )}

      <div className="flex items-center h-6 px-3 border-b border-line-2 bg-ground-3 text-micro font-semibold uppercase text-ink-4 flex-shrink-0">
        <span className="flex-[2] min-w-0">Person</span>
        <span className="flex-[3] min-w-0">Why they're here</span>
        <span className="w-40">Illinois tie</span>
        <span className="w-24">Found via</span>
        <span className="w-36 text-right pr-1">Triage</span>
      </div>

      <div className="flex-1 overflow-y-auto">
        {!data ? (
          Array.from({ length: 14 }).map((_, i) => (
            <div key={i} className="row px-3">
              <span className="flex-[2]"><span className="block h-2 w-28 bg-ground-3 rounded-sm" /></span>
              <span className="flex-[3]"><span className="block h-2 w-56 bg-ground-3 rounded-sm" /></span>
              <span className="w-40"><span className="block h-2 w-20 bg-ground-3 rounded-sm" /></span>
              <span className="w-24"><span className="block h-2 w-14 bg-ground-3 rounded-sm" /></span>
              <span className="w-36" />
            </div>
          ))
        ) : rows.length === 0 ? (
          // Not a blank state — a diagnosis. An empty inbox means one of two very
          // different things, and the old Discover screen taught Danny to read the
          // ambiguous version as "broken".
          <div className="px-3 py-4 text-small text-ink-3 max-w-2xl">
            {data.total === 0 && !q ? (
              <>
                Nothing waiting. The scout found no new Illinois-tied founders — that's an
                answer, not a failure.{' '}
                {data.watchlist > 0 && (
                  <button className="text-accent" onClick={() => setScope('watchlist')}>
                    {data.watchlist} are on the national Frontier Watch →
                  </button>
                )}
              </>
            ) : (
              'Nothing matches that filter.'
            )}
          </div>
        ) : (
          rows.map((r, i) => (
            <div
              key={r.id}
              onMouseEnter={() => setCursor(i)}
              onClick={() => setOpenId(r.id)}
              className={`row px-3 group cursor-pointer ${i === cursor || r.id === openId ? 'row-selected' : ''} ${
                busy === r.id ? 'opacity-40' : ''
              }`}
            >
              <span className="flex-[2] min-w-0 flex items-baseline gap-2">
                <span className="row-primary flex-none max-w-[150px]">{r.name}</span>
                {r.company && <span className="row-meta min-w-0">{r.company}</span>}
              </span>

              {/* The reason this stranger is in front of him. Without it the row is
                  just a name, and a name is not a reason to read anything. */}
              <span className="flex-[3] min-w-0 text-ink-2 truncate" title={r.headline || ''}>
                {signalOf(r) || <span className="text-ink-4">no signal recorded</span>}
              </span>

              {/* Geography is the moat, so the tie is a column and its evidence is on
                  hover. 55 of 85 rows here once carried a fabricated Chicago tie, and
                  it survived four months because nobody could see it. */}
              <span className="w-40 min-w-0 text-mini truncate" title={r.chicago_connection || 'no verified Illinois tie'}>
                {r.location_type === 'cofounder' ? (
                  <span className="text-ink-3">via co-founder</span>
                ) : r.location_type ? (
                  <span className="text-ink-2">
                    {r.location_type}
                    <span className="text-ink-4">
                      {' · '}
                      {String(r.chicago_connection || '').split(' — ')[0].split(': ')[1] || ''}
                    </span>
                  </span>
                ) : (
                  <span className="text-ink-4">—</span>
                )}
              </span>

              <span className="w-24 text-ink-3 text-mini truncate">{r.source}</span>

              <span className="w-36 flex items-center justify-end gap-1">
                {/* LinkedIn is always visible, never hover-gated. Danny: "jump off
                    to see their LinkedIn" — it's the single most-used action on a
                    stranger, and hiding it behind hover taxes every row. */}
                {r.linkedin_url && (
                  <a
                    href={r.linkedin_url}
                    target="_blank"
                    rel="noopener noreferrer"
                    onClick={(e) => e.stopPropagation()}
                    className="px-1.5 h-5 rounded text-mini font-medium text-ink-3 border border-line-2 hover:border-accent hover:text-accent transition flex items-center"
                    title="Open LinkedIn"
                  >
                    in ↗
                  </a>
                )}
                <span className="flex items-center gap-1 opacity-0 group-hover:opacity-100 focus-within:opacity-100 transition">
                  <button
                    onClick={(e) => { e.stopPropagation(); triage(r, 'approve'); }}
                    className="px-2 h-5 rounded text-mini font-medium bg-ink text-white hover:bg-ink-2 transition"
                    title="Create the company card and put it on the pipeline (t)"
                  >
                    Add
                  </button>
                  <button
                    onClick={(e) => { e.stopPropagation(); triage(r, 'dismiss'); }}
                    className="px-2 h-5 rounded text-mini text-ink-3 border border-line-2 hover:bg-ground-4 hover:text-ink transition"
                    title="Pass for now (x)"
                  >
                    Pass
                  </button>
                </span>
              </span>
            </div>
          ))
        )}
      </div>

      {open && (
        <Detail
          row={open}
          onClose={() => setOpenId(null)}
          onTriage={(action) => { triage(open, action); setOpenId(null); }}
        />
      )}

      <div className="flex items-center gap-3 px-3 h-6 border-t border-line-2 bg-ground text-micro text-ink-4 flex-shrink-0">
        <span><kbd className="text-ink-3">j</kbd>/<kbd className="text-ink-3">k</kbd> read</span>
        <span><kbd className="text-ink-3">↵</kbd> study</span>
        <span><kbd className="text-ink-3">t</kbd> add</span>
        <span><kbd className="text-ink-3">x</kbd> pass</span>
        <div className="flex-1" />
        <span>{rows.length} waiting</span>
      </div>
    </div>
  );
}

// ══════════════════════════════════════════════════════════════════════════
// The study panel. Danny: "I could see a bit about the founder. That paradigm
// worked well."
//
// Everything here is EVIDENCE, not inference. The verbatim quotes from their
// profile are the point — the tie gate and the caliber scorer both make claims,
// and this is where he checks them against the actual words. Machine-written
// prose (the enrichment summary) sits at ink-3 and is labelled as such; quoted
// profile text is the founder's own and reads darker.
// ══════════════════════════════════════════════════════════════════════════
function Detail({ row, onClose, onTriage }) {
  let ev = {};
  try { ev = JSON.parse(row.evidence_map || '{}') || {}; } catch { /* not fatal */ }
  const quotes = [
    ['Illinois tie', ev.tie_evidence],
    ['Caliber', ev.caliber_evidence],
    ['Stage', ev.stage_evidence],
  ].filter(([, q]) => q && String(q).trim());

  const links = [
    ['LinkedIn', row.linkedin_url],
    ['GitHub', row.github_url],
    ['Website', row.website_url],
  ].filter(([, u]) => u);

  return (
    <>
      <div className="fixed inset-0 bg-ink/5 z-30" onClick={onClose} />
      <aside className="fixed right-0 top-0 bottom-0 w-[420px] bg-ground border-l border-line-2 z-40 flex flex-col">
        <div className="flex items-center gap-2 h-8 px-3 border-b border-line-2 flex-shrink-0">
          <span className="text-small font-semibold text-ink truncate">{row.name}</span>
          {row.company && <span className="text-mini text-ink-3 truncate">{row.company}</span>}
          <div className="flex-1" />
          <button onClick={onClose} className="text-mini text-ink-4 hover:text-ink">Esc</button>
        </div>

        <div className="flex-1 overflow-y-auto px-3 py-3 space-y-4">
          {links.length > 0 && (
            <div className="flex items-center gap-2">
              {links.map(([label, url]) => (
                <a
                  key={label}
                  href={url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-small font-medium text-accent hover:text-accent-hover"
                >
                  {label} ↗
                </a>
              ))}
            </div>
          )}

          <Section label="Illinois tie">
            {row.location_type ? (
              <>
                <div className="text-small text-ink">
                  {row.location_type === 'cofounder' ? 'Via a co-founder' : row.location_type}
                </div>
                {/* The evidence IS the tie. 55 of 85 rows once carried a fabricated
                    one, and it survived four months because nobody could read it. */}
                <p className="text-mini text-ink-3 mt-1 leading-relaxed">{row.chicago_connection}</p>
              </>
            ) : (
              <p className="text-mini text-ink-3">
                No verified Illinois tie — this row is on the national Frontier Watch.
              </p>
            )}
          </Section>

          {signalOf(row) && (
            <Section label="What their profile says">
              <p className="text-small text-ink leading-relaxed">{signalOf(row)}</p>
            </Section>
          )}

          {quotes.length > 0 && (
            <Section label="Verbatim, from their profile">
              <div className="space-y-2">
                {quotes.map(([k, q]) => (
                  <div key={k} className="border-l-2 border-line-2 pl-2">
                    <div className="text-micro uppercase text-ink-4">{k}</div>
                    <p className="text-mini text-ink-2 leading-relaxed">“{String(q).slice(0, 280)}”</p>
                  </div>
                ))}
              </div>
            </Section>
          )}

          {parseArr(row.caliber_signals).length > 0 && (
            <Section label={`Why caliber ${row.caliber_tier || ''}`.trim()}>
              <div className="flex flex-wrap gap-1">
                {parseArr(row.caliber_signals).map((s, i) => (
                  <span key={i} className="text-mini text-ink-2 bg-ground-3 rounded-sm px-1.5 py-0.5">{s}</span>
                ))}
              </div>
            </Section>
          )}

          {parseArr(row.builder_signals).length > 0 && (
            <Section label="Builder signals">
              <div className="flex flex-wrap gap-1">
                {parseArr(row.builder_signals).map((s, i) => (
                  <span key={i} className="text-mini text-ink-2 bg-ground-3 rounded-sm px-1.5 py-0.5">{s}</span>
                ))}
              </div>
            </Section>
          )}

          {row.confidence_rationale && (
            // Machine-written. Recedes to ink-3 with no badge — Granola's rule.
            <Section label="Stu's note">
              <p className="text-mini text-ink-3 leading-relaxed">{row.confidence_rationale}</p>
            </Section>
          )}

          <Section label="Found via">
            <p className="text-mini text-ink-3">
              {row.source}
              {row.created_at && ` · ${String(row.created_at).slice(0, 10)}`}
            </p>
          </Section>
        </div>

        {/* The vote. One primary action, and Pass is not destructive — it's a
            respectable answer, so it never renders red. */}
        <div className="flex items-center gap-2 px-3 h-10 border-t border-line-2 flex-shrink-0">
          <button onClick={() => onTriage('approve')} className="btn-primary flex-1 justify-center">
            Add to pipeline
          </button>
          <button onClick={() => onTriage('dismiss')} className="btn-secondary flex-1 justify-center">
            Pass
          </button>
          <button
            onClick={() => onTriage('hide')}
            className="btn-ghost"
            title="Never surface this person again"
          >
            Never
          </button>
        </div>
      </aside>
    </>
  );
}

function Section({ label, children }) {
  return (
    <div>
      <div className="text-micro font-semibold uppercase text-ink-4 mb-1">{label}</div>
      {children}
    </div>
  );
}
