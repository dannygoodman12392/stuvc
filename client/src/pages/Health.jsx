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
    </div>
  );
}
