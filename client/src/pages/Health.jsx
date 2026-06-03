import { useState, useEffect } from 'react';
import { api } from '../utils/api';

const DOT = { green: 'bg-emerald-500', yellow: 'bg-amber-500', red: 'bg-red-500', gray: 'bg-gray-300' };
const OVERALL = {
  green: { label: 'All systems healthy', cls: 'text-emerald-700 bg-emerald-50 border-emerald-200' },
  yellow: { label: 'Attention needed', cls: 'text-amber-700 bg-amber-50 border-amber-200' },
  red: { label: 'Action required', cls: 'text-red-700 bg-red-50 border-red-200' },
};

export default function Health() {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);

  async function load() {
    setLoading(true);
    try { setData(await api.getHealthFull()); } catch (e) { setData({ overall: 'red', checks: [{ name: 'Healthcheck', status: 'red', detail: e.message }] }); }
    finally { setLoading(false); }
  }
  useEffect(() => { load(); }, []);

  if (loading) return <div className="text-center py-12 text-gray-500 text-sm">Loading…</div>;
  const d = data || { overall: 'gray', checks: [] };
  const o = OVERALL[d.overall] || OVERALL.green;

  return (
    <div className="max-w-2xl mx-auto px-4 py-6">
      <div className="flex items-center justify-between mb-4">
        <h1 className="text-2xl font-semibold text-gray-900 tracking-tight">Health</h1>
        <button onClick={load} className="text-xs font-medium px-3 py-1.5 rounded-lg border border-gray-200 text-gray-600 hover:border-gray-300">Refresh</button>
      </div>

      <div className={`rounded-lg border px-4 py-3 mb-5 ${o.cls}`}>
        <span className="text-sm font-semibold">{o.label}</span>
        {d.at && <span className="text-xs opacity-70 ml-2">checked {new Date(d.at).toLocaleTimeString()}</span>}
      </div>

      <div className="card divide-y divide-gray-100">
        {d.checks.map((c, i) => (
          <div key={i} className="flex items-start gap-3 px-4 py-3">
            <span className={`mt-1.5 w-2.5 h-2.5 rounded-full flex-shrink-0 ${DOT[c.status] || DOT.gray}`} />
            <div className="min-w-0">
              <div className="text-sm font-medium text-gray-900">{c.name}</div>
              {c.detail && <div className="text-xs text-gray-500 mt-0.5 break-words">{c.detail}</div>}
            </div>
          </div>
        ))}
      </div>

      <NotionDrift />
    </div>
  );
}

function NotionDrift() {
  const [state, setState] = useState(null);
  const [busy, setBusy] = useState(false);
  async function run(repair) {
    setBusy(true);
    try { setState(await api.checkNotionDrift(repair)); } catch (e) { setState({ error: e.message }); }
    finally { setBusy(false); }
  }
  return (
    <div className="card p-4 mt-5">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-sm font-semibold text-gray-900">Notion mirror</h2>
          <p className="text-xs text-gray-400 mt-0.5">Check that every investment-track founder exists in your Notion mirror. Repair re-pushes any missing from SQLite (canonical).</p>
        </div>
        <div className="flex gap-2">
          <button onClick={() => run(false)} disabled={busy} className="text-xs font-medium px-3 py-1.5 rounded-lg border border-gray-200 text-gray-600 hover:border-gray-300 disabled:opacity-50">{busy ? 'Checking…' : 'Check drift'}</button>
          {state && state.missing && state.missing.length > 0 && (
            <button onClick={() => run(true)} disabled={busy} className="text-xs font-medium px-3 py-1.5 rounded-lg bg-gray-900 text-white hover:bg-gray-800 disabled:opacity-50">Repair {state.missing.length}</button>
          )}
        </div>
      </div>
      {state && (
        <div className="mt-3 text-xs">
          {state.error ? <span className="text-red-600">{state.error}</span>
            : !state.configured ? <span className="text-gray-400">Notion not configured.</span>
            : state.missing.length === 0 ? <span className="text-emerald-600">In sync — {state.checked} founders verified{state.repaired ? `, ${state.repaired} repaired` : ''}.</span>
            : <span className="text-amber-600">{state.missing.length} of {state.checked} missing from Notion{state.repaired ? ` · ${state.repaired} repaired` : ''}: {state.missing.slice(0, 8).map(m => m.name).join(', ')}</span>}
        </div>
      )}
    </div>
  );
}
