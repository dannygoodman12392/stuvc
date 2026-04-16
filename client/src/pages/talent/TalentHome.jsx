import { useState, useEffect } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../../utils/api';
import { useToast } from '../../components/Toast';

function Stat({ label, value, hint }) {
  return (
    <div className="card p-4">
      <div className="text-[11px] text-gray-500 uppercase tracking-wide font-medium">{label}</div>
      <div className="text-2xl font-semibold text-gray-900 mt-1 tabular-nums">{value ?? 0}</div>
      {hint && <div className="text-xs text-gray-400 mt-0.5">{hint}</div>}
    </div>
  );
}

export default function TalentHome() {
  const [stats, setStats] = useState(null);
  const [runs, setRuns] = useState([]);
  const [loading, setLoading] = useState(true);
  const [running, setRunning] = useState(false);
  const [matching, setMatching] = useState(false);
  const { toast } = useToast();

  async function load() {
    try {
      const [s, r] = await Promise.all([api.getTalentSourcingStats(), api.getTalentSourcingRuns()]);
      setStats(s);
      setRuns(r);
    } catch (err) {
      toast({ message: `Failed to load: ${err.message}`, tone: 'error' });
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { load(); }, []);

  async function runSourcing() {
    setRunning(true);
    try {
      await api.triggerTalentSourcing();
      toast({ message: 'Talent sourcing started — check back in a few minutes' });
    } catch (err) {
      toast({ message: err.message, tone: 'error' });
    } finally {
      setRunning(false);
    }
  }

  async function runMatching() {
    setMatching(true);
    try {
      await api.triggerTalentMatching();
      toast({ message: 'Matching run started' });
    } catch (err) {
      toast({ message: err.message, tone: 'error' });
    } finally {
      setMatching(false);
    }
  }

  if (loading) return <div className="text-sm text-gray-400">Loading...</div>;

  return (
    <div className="space-y-6">
      <div className="flex items-start justify-end">
        <div className="flex items-center gap-2">
          <button onClick={runMatching} disabled={matching} className="btn-secondary">
            {matching ? 'Queued...' : 'Rerun matches'}
          </button>
          <button onClick={runSourcing} disabled={running} className="btn-primary bg-amber-600 hover:bg-amber-700 border-0">
            {running ? 'Running...' : 'Run sourcing'}
          </button>
        </div>
      </div>

      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <Stat label="Companies" value={stats?.portfolio_total} />
        <Stat label="Open roles" value={stats?.roles_open} hint={stats?.roles_urgent ? `${stats.roles_urgent} urgent` : null} />
        <Stat label="New candidates" value={stats?.candidates_new} hint={`${stats?.candidates_total || 0} total`} />
        <Stat label="Pending matches" value={stats?.matches_pending} hint={stats?.matches_shortlisted ? `${stats.matches_shortlisted} shortlisted` : null} />
      </div>

      <section>
        <div className="flex items-center justify-between mb-3">
          <h2 className="text-sm font-semibold text-gray-900">Top matches</h2>
          <Link to="/talent/matches" className="text-xs text-amber-700 hover:text-amber-800 font-medium">View all →</Link>
        </div>
        {(!stats?.top_matches || stats.top_matches.length === 0) ? (
          <div className="card p-6 text-center text-sm text-gray-400">
            No matches yet. Add roles and run sourcing to see candidates.
          </div>
        ) : (
          <div className="card divide-y divide-gray-100">
            {stats.top_matches.map(m => (
              <Link key={m.id} to={`/talent/matches`} className="flex items-center gap-4 px-4 py-3 hover:bg-gray-50 transition-colors">
                <div className="w-10 h-10 rounded-full bg-amber-50 border border-amber-100 flex items-center justify-center text-amber-700 font-semibold text-sm tabular-nums">
                  {m.match_score}
                </div>
                <div className="flex-1 min-w-0">
                  <div className="flex items-baseline gap-2">
                    <span className="text-sm font-medium text-gray-900 truncate">{m.candidate_name}</span>
                    <span className="text-xs text-gray-400">→</span>
                    <span className="text-sm text-gray-600 truncate">{m.role_title}</span>
                    {m.company_name && <span className="text-xs text-gray-400">· {m.company_name}</span>}
                  </div>
                  <div className="text-xs text-gray-500 mt-0.5 truncate">{m.match_rationale}</div>
                </div>
              </Link>
            ))}
          </div>
        )}
      </section>

      <section>
        <div className="flex items-center justify-between mb-3">
          <h2 className="text-sm font-semibold text-gray-900">Recent candidates</h2>
          <Link to="/talent/candidates" className="text-xs text-amber-700 hover:text-amber-800 font-medium">View all →</Link>
        </div>
        {(!stats?.recent_candidates || stats.recent_candidates.length === 0) ? (
          <div className="card p-6 text-center text-sm text-gray-400">No candidates yet.</div>
        ) : (
          <div className="card divide-y divide-gray-100">
            {stats.recent_candidates.map(c => (
              <Link key={c.id} to={`/talent/candidates/${c.id}`} className="flex items-center justify-between px-4 py-3 hover:bg-gray-50 transition-colors">
                <div className="min-w-0 flex-1">
                  <div className="text-sm font-medium text-gray-900 truncate">{c.name}</div>
                  <div className="text-xs text-gray-500 truncate">
                    {c.headline || `${c.current_role || ''}${c.current_company ? ' · ' + c.current_company : ''}`}
                  </div>
                </div>
                {c.overall_score && (
                  <span className="badge badge-amber tabular-nums">{c.overall_score}/10</span>
                )}
              </Link>
            ))}
          </div>
        )}
      </section>

      {runs.length > 0 && (
        <section>
          <h2 className="text-sm font-semibold text-gray-900 mb-3">Recent sourcing runs</h2>
          <div className="card divide-y divide-gray-100">
            {runs.slice(0, 5).map(r => (
              <div key={r.id} className="flex items-center justify-between px-4 py-2 text-sm">
                <span className="text-gray-700">{new Date(r.run_at).toLocaleString()}</span>
                <span className="text-xs text-gray-500">
                  {r.candidates_added} added · {r.candidates_evaluated} evaluated
                </span>
              </div>
            ))}
          </div>
        </section>
      )}
    </div>
  );
}
