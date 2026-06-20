import { useState, useEffect, useCallback } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../utils/api';

// Fallback if the catalog endpoint is unavailable.
const FALLBACK_SIGNALS = [
  { key: 'just_departed', label: 'Just departed' },
  { key: 'stealth_building', label: 'Stealth / building new' },
  { key: 'founder_factory_alum', label: 'Founder-factory alum' },
  { key: 'repeat_founder', label: 'Repeat founder' },
  { key: 'breakout_builder', label: 'Breakout builder' },
  { key: 'credentialed_outlier', label: 'Credentialed outlier' },
  { key: 'fresh_incorporation', label: 'Fresh incorporation' },
];

function scoreColor(s) {
  if (s == null) return 'bg-gray-100 text-gray-400 ring-gray-200';
  if (s >= 85) return 'bg-emerald-50 text-emerald-700 ring-emerald-200';
  if (s >= 70) return 'bg-blue-50 text-blue-700 ring-blue-200';
  if (s >= 50) return 'bg-amber-50 text-amber-700 ring-amber-200';
  return 'bg-gray-100 text-gray-500 ring-gray-200';
}

export default function Discover() {
  const [signals, setSignals] = useState(FALLBACK_SIGNALS);
  const [selected, setSelected] = useState(new Set(['just_departed']));
  const [target, setTarget] = useState('sourcing');
  const [query, setQuery] = useState('');
  const [loading, setLoading] = useState(false);
  const [results, setResults] = useState(null);
  const [meta, setMeta] = useState(null);
  const [error, setError] = useState('');
  const [noKey, setNoKey] = useState(false);
  const [outreach, setOutreach] = useState(null); // { person, intent, message, loading }

  useEffect(() => {
    api.getMcpInfo()
      .then(i => { if (i.builderSignals?.length) setSignals(i.builderSignals); })
      .catch(() => {});
  }, []);

  const toggle = (key) => setSelected(prev => {
    const next = new Set(prev);
    next.has(key) ? next.delete(key) : next.add(key);
    return next;
  });

  const run = useCallback(async () => {
    setLoading(true); setError(''); setNoKey(false); setResults(null); setMeta(null);
    try {
      const r = await api.discover({ signals: [...selected], query: query.trim(), target, limit: 24 });
      setResults(r.results || []); setMeta({ found: r.found, saved: r.saved, enriched: r.results?.some(x => x.unicorn_score != null) });
    } catch (e) {
      if (/exa/i.test(e.message) || e.code === 'no_key') setNoKey(true);
      else setError(e.message || 'Discovery failed');
    } finally { setLoading(false); }
  }, [selected, query, target]);

  const openOutreach = (p) => setOutreach({ person: p, intent: target === 'talent' ? 'recruit' : 'invest', message: '', loading: true });

  useEffect(() => {
    if (!outreach || !outreach.loading) return;
    let cancelled = false;
    api.draftOutreach({ person: { name: outreach.person.name, headline: outreach.person.headline, company: outreach.person.company, role: outreach.person.role, why: outreach.person.why }, intent: outreach.intent })
      .then(r => { if (!cancelled) setOutreach(o => o && ({ ...o, message: r.message, loading: false })); })
      .catch(e => { if (!cancelled) setOutreach(o => o && ({ ...o, message: '', error: e.message, loading: false })); });
    return () => { cancelled = true; };
  }, [outreach?.loading, outreach?.intent]);

  return (
    <div className="max-w-5xl">
      {/* Hero */}
      <div className="mb-6">
        <h1 className="text-2xl font-semibold text-gray-900 flex items-center gap-2">
          Discover
          <span className="text-xs font-medium text-emerald-700 bg-emerald-50 ring-1 ring-emerald-200 rounded-full px-2 py-0.5">live web</span>
        </h1>
        <p className="text-sm text-gray-500 mt-1">Find unicorn builders the moment they're reachable — ranked, scored, and explained.</p>
      </div>

      {/* Controls */}
      <div className="card p-5 space-y-4">
        <div className="flex flex-wrap gap-2">
          {signals.map(s => {
            const on = selected.has(s.key);
            return (
              <button key={s.key} onClick={() => toggle(s.key)} title={s.description || ''}
                className={`text-sm px-3 py-1.5 rounded-full border transition-colors ${on ? 'bg-gray-900 text-white border-gray-900' : 'bg-white text-gray-600 border-gray-200 hover:border-gray-400'}`}>
                {s.label}
              </button>
            );
          })}
        </div>

        <div className="flex flex-col sm:flex-row gap-3 sm:items-center">
          <div className="inline-flex rounded-lg border border-gray-200 p-0.5 self-start">
            {['sourcing', 'talent'].map(t => (
              <button key={t} onClick={() => setTarget(t)}
                className={`text-sm px-3 py-1.5 rounded-md ${target === t ? 'bg-gray-900 text-white' : 'text-gray-600 hover:text-gray-900'}`}>
                {t === 'sourcing' ? 'Founders' : 'Talent'}
              </button>
            ))}
          </div>
          <input value={query} onChange={e => setQuery(e.target.value)} onKeyDown={e => e.key === 'Enter' && run()}
            placeholder="Refine (optional): e.g. AI infra, fintech, Chicago…"
            className="flex-1 px-3 py-2 text-sm border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-gray-900/10" />
          <button onClick={run} disabled={loading || selected.size === 0}
            className="btn-primary text-sm px-5 py-2 disabled:opacity-50 whitespace-nowrap">
            {loading ? 'Discovering…' : 'Discover'}
          </button>
        </div>
      </div>

      {/* No-key nudge */}
      {noKey && (
        <div className="mt-5 card p-5 border-amber-200 bg-amber-50">
          <p className="text-sm font-medium text-amber-900">Add your Exa key to discover from the web</p>
          <p className="text-sm text-amber-800 mt-1">Discovery searches the live web on your own Exa key (billed to you, not the platform). Add it once and you're set.</p>
          <Link to="/settings" className="inline-block mt-2 text-sm font-medium text-amber-900 underline">Go to Settings → API Keys</Link>
        </div>
      )}
      {error && <p className="mt-4 text-sm text-red-600">{error}</p>}

      {/* Loading skeleton */}
      {loading && (
        <div className="mt-6 grid sm:grid-cols-2 gap-4">
          {Array.from({ length: 4 }).map((_, i) => (
            <div key={i} className="card p-5 animate-pulse"><div className="h-4 bg-gray-100 rounded w-1/2" /><div className="h-3 bg-gray-100 rounded w-3/4 mt-3" /><div className="h-3 bg-gray-100 rounded w-2/3 mt-2" /></div>
          ))}
        </div>
      )}

      {/* Results */}
      {results && !loading && (
        <div className="mt-6">
          <div className="flex items-center justify-between mb-3">
            <p className="text-sm text-gray-500">{meta?.found || 0} found{meta?.saved ? ` · ${meta.saved} saved to your account` : ''}{meta?.enriched ? ' · scored by AI' : ''}</p>
          </div>
          {results.length === 0 ? (
            <div className="card p-8 text-center">
              <p className="text-sm font-medium text-gray-900">No matches this time</p>
              <p className="text-sm text-gray-500 mt-1">Try different signals or a broader refine term.</p>
            </div>
          ) : (
            <div className="grid sm:grid-cols-2 gap-4">
              {results.map((p, i) => (
                <div key={i} className="card p-5 flex flex-col">
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <p className="font-medium text-gray-900 truncate">{p.name}</p>
                      <p className="text-sm text-gray-500 truncate">{[p.role, p.company].filter(Boolean).join(' · ') || p.headline}</p>
                    </div>
                    {p.unicorn_score != null && (
                      <div className={`flex-shrink-0 w-11 h-11 rounded-full ring-1 grid place-items-center text-sm font-semibold ${scoreColor(p.unicorn_score)}`} title="Unicorn-builder score">
                        {p.unicorn_score}
                      </div>
                    )}
                  </div>

                  {p.why && <p className="text-sm text-gray-700 mt-3 leading-snug">{p.why}</p>}
                  {p.summary && <p className="text-xs text-gray-500 mt-1.5 leading-snug">{p.summary}</p>}

                  <div className="flex flex-wrap gap-1.5 mt-3">
                    {(p.matched_signals || []).map(s => (
                      <span key={s.key} className="text-[11px] text-gray-600 bg-gray-100 rounded-full px-2 py-0.5">{s.label || s.key}</span>
                    ))}
                  </div>

                  <div className="flex items-center gap-3 mt-4 pt-3 border-t border-gray-100">
                    {p.linkedin_url && <a href={p.linkedin_url} target="_blank" rel="noreferrer" className="text-xs text-blue-600 hover:underline">LinkedIn ↗</a>}
                    <button onClick={() => openOutreach(p)} className="text-xs font-medium text-gray-900 hover:underline ml-auto">Draft outreach</button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* First-run prompt */}
      {!results && !loading && !noKey && (
        <div className="mt-6 card p-8 text-center">
          <p className="text-sm font-medium text-gray-900">Pick signals and hit Discover</p>
          <p className="text-sm text-gray-500 mt-1">e.g. <span className="font-medium">Just departed</span> → YC founders who just left, pulled fresh from the web in seconds.</p>
        </div>
      )}

      {/* Outreach drawer */}
      {outreach && (
        <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-black/30 p-4" onClick={() => setOutreach(null)}>
          <div className="bg-white rounded-xl shadow-xl w-full max-w-lg p-5" onClick={e => e.stopPropagation()}>
            <div className="flex items-center justify-between">
              <h3 className="text-sm font-semibold text-gray-900">Outreach to {outreach.person.name}</h3>
              <button onClick={() => setOutreach(null)} className="text-gray-400 hover:text-gray-600 text-lg leading-none">×</button>
            </div>
            <div className="flex gap-1.5 mt-3">
              {['recruit', 'invest', 'connect'].map(it => (
                <button key={it} onClick={() => setOutreach(o => ({ ...o, intent: it, loading: true, message: '' }))}
                  className={`text-xs px-2.5 py-1 rounded-full border ${outreach.intent === it ? 'bg-gray-900 text-white border-gray-900' : 'border-gray-200 text-gray-600'}`}>{it}</button>
              ))}
            </div>
            {outreach.loading ? (
              <div className="mt-4 h-32 grid place-items-center text-sm text-gray-400">Drafting…</div>
            ) : outreach.error ? (
              <p className="mt-4 text-sm text-red-600">{outreach.error}{/anthropic/i.test(outreach.error) && <> — <Link to="/settings" className="underline">add your key</Link></>}</p>
            ) : (
              <>
                <textarea value={outreach.message} onChange={e => setOutreach(o => ({ ...o, message: e.target.value }))}
                  className="mt-4 w-full h-44 text-sm border border-gray-200 rounded-lg p-3 focus:outline-none focus:ring-2 focus:ring-gray-900/10" />
                <div className="flex justify-end mt-3">
                  <button onClick={() => navigator.clipboard?.writeText(outreach.message)} className="btn-primary text-sm px-4 py-2">Copy</button>
                </div>
              </>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
