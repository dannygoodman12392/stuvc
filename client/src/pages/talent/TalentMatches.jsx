import { useState, useEffect } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../../utils/api';
import { useToast } from '../../components/Toast';

const STATUS_COLORS = {
  suggested: 'badge-blue', shortlisted: 'badge-green',
  intro_drafted: 'badge-amber', intro_sent: 'badge-purple',
  in_process: 'badge-purple', hired: 'badge-green',
  passed: 'badge-gray', rejected: 'badge-red',
};

const STATUS_OPTIONS = ['suggested', 'shortlisted', 'intro_drafted', 'intro_sent', 'in_process', 'hired', 'passed', 'rejected'];

function ScoreDot({ score }) {
  const color = score >= 80 ? 'bg-emerald-500' : score >= 65 ? 'bg-amber-500' : 'bg-gray-300';
  return <div className={`w-2.5 h-2.5 rounded-full ${color}`} />;
}

export default function TalentMatches() {
  const [matches, setMatches] = useState([]);
  const [stats, setStats] = useState({});
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState({ status: 'suggested', minScore: '' });
  const [selected, setSelected] = useState(new Set());
  const [expanded, setExpanded] = useState(null);
  const { toast } = useToast();

  useEffect(() => { load(); }, [filter.status, filter.minScore]);

  async function load() {
    setLoading(true);
    try {
      const params = {};
      if (filter.status !== 'all') params.status = filter.status;
      if (filter.minScore) params.minScore = filter.minScore;
      const [rows, s] = await Promise.all([api.getTalentMatches(params), api.getTalentMatchStats()]);
      setMatches(rows);
      setStats(s);
    } catch (err) {
      toast({ message: err.message, tone: 'error' });
    } finally {
      setLoading(false);
    }
  }

  async function setStatus(id, status) {
    try {
      await api.updateTalentMatch(id, { status });
      setMatches(ms => ms.map(m => m.id === id ? { ...m, status } : m));
      toast({ message: 'Status updated', duration: 1500 });
    } catch (err) {
      toast({ message: err.message, tone: 'error' });
    }
  }

  function toggleSelect(id) {
    setSelected(p => { const n = new Set(p); n.has(id) ? n.delete(id) : n.add(id); return n; });
  }

  async function bulkStatus(status) {
    const ids = Array.from(selected);
    if (!ids.length) return;
    try {
      await api.bulkUpdateTalentMatches(ids, { status });
      setSelected(new Set());
      load();
    } catch (err) {
      toast({ message: err.message, tone: 'error' });
    }
  }

  return (
    <div className="space-y-5">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold text-gray-900 tracking-tight">Match queue</h1>
          <p className="text-sm text-gray-500 mt-1">Ranked candidate ↔ role pairs.</p>
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <div className="flex items-center gap-1 p-0.5 bg-gray-100 rounded-lg">
          {['suggested', 'shortlisted', 'in_process', 'all'].map(s => (
            <button
              key={s}
              onClick={() => setFilter({ ...filter, status: s })}
              className={`px-3 py-1 text-xs font-medium rounded-md transition-colors ${
                filter.status === s ? 'bg-white text-gray-900 shadow-sm' : 'text-gray-500 hover:text-gray-700'
              }`}
            >
              {s === 'all' ? 'All' : s.replace('_', ' ')} {stats[s] != null && s !== 'all' ? `(${stats[s]})` : ''}
            </button>
          ))}
        </div>
        <select className="select" value={filter.minScore} onChange={e => setFilter({ ...filter, minScore: e.target.value })}>
          <option value="">Any score</option>
          <option value="80">≥ 80</option>
          <option value="65">≥ 65</option>
          <option value="50">≥ 50</option>
        </select>
      </div>

      {selected.size > 0 && (
        <div className="flex items-center justify-between bg-amber-50 border border-amber-200 rounded-lg px-4 py-2">
          <span className="text-sm text-amber-900">{selected.size} selected</span>
          <div className="flex gap-2">
            <button onClick={() => bulkStatus('shortlisted')} className="btn-ghost text-xs">Shortlist</button>
            <button onClick={() => bulkStatus('passed')} className="btn-ghost text-xs">Pass</button>
            <button onClick={() => setSelected(new Set())} className="btn-ghost text-xs">Clear</button>
          </div>
        </div>
      )}

      {loading ? (
        <div className="text-sm text-gray-400">Loading...</div>
      ) : matches.length === 0 ? (
        <div className="card p-8 text-center text-sm text-gray-400">
          No matches in this view.
        </div>
      ) : (
        <div className="space-y-2">
          {matches.map(m => (
            <div key={m.id} className="card hover:border-gray-300 transition-colors">
              <div className="flex items-start gap-4 p-4">
                <input type="checkbox" className="mt-1" checked={selected.has(m.id)} onChange={() => toggleSelect(m.id)} />
                <div className="flex items-center gap-2 flex-shrink-0">
                  <ScoreDot score={m.match_score} />
                  <div className="text-lg font-semibold text-gray-900 tabular-nums w-10">{m.match_score}</div>
                </div>
                <div className="flex-1 min-w-0">
                  <div className="flex items-baseline gap-2 flex-wrap">
                    <Link to={`/talent/candidates/${m.candidate_id}`} className="font-medium text-gray-900 hover:text-amber-700">
                      {m.candidate_name}
                    </Link>
                    <span className="text-xs text-gray-400">→</span>
                    <Link to={`/talent/roles/${m.role_id}`} className="text-sm text-gray-700 hover:text-amber-700">
                      {m.role_title}
                    </Link>
                    {m.company_name && <span className="text-xs text-gray-400">· {m.company_name}</span>}
                    {m.role_band && <span className="badge badge-amber text-[10px]">Band {m.role_band}</span>}
                  </div>
                  <div className="text-xs text-gray-500 mt-1">
                    {m.current_role || m.headline}{m.current_company ? ` · ${m.current_company}` : ''}{m.location_city ? ` · ${m.location_city}` : ''}
                  </div>
                  {expanded === m.id ? (
                    <div className="mt-3 space-y-2 text-sm">
                      <div className="text-gray-700">{m.match_rationale}</div>
                      {m.strengths?.length > 0 && (
                        <div>
                          <span className="text-xs font-semibold text-emerald-700 uppercase tracking-wide">Strengths</span>
                          <ul className="mt-1 space-y-0.5 text-xs text-gray-600">
                            {m.strengths.map((s, i) => <li key={i}>+ {s}</li>)}
                          </ul>
                        </div>
                      )}
                      {m.gaps?.length > 0 && (
                        <div>
                          <span className="text-xs font-semibold text-amber-700 uppercase tracking-wide">Gaps</span>
                          <ul className="mt-1 space-y-0.5 text-xs text-gray-600">
                            {m.gaps.map((s, i) => <li key={i}>– {s}</li>)}
                          </ul>
                        </div>
                      )}
                      <button onClick={() => setExpanded(null)} className="text-xs text-gray-500 hover:text-gray-700">Hide details</button>
                    </div>
                  ) : (
                    <div className="text-xs text-gray-600 mt-1 line-clamp-1">
                      {m.match_rationale}
                      <button onClick={() => setExpanded(m.id)} className="ml-2 text-amber-700 hover:text-amber-800">More</button>
                    </div>
                  )}
                </div>
                <div className="flex items-center gap-2 flex-shrink-0">
                  <span className={`badge ${STATUS_COLORS[m.status] || 'badge-gray'}`}>{m.status}</span>
                  <select
                    value={m.status}
                    onChange={e => setStatus(m.id, e.target.value)}
                    className="select text-xs py-1"
                  >
                    {STATUS_OPTIONS.map(s => <option key={s} value={s}>{s.replace('_', ' ')}</option>)}
                  </select>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
