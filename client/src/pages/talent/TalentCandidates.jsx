import { useState, useEffect } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../../utils/api';
import { useToast } from '../../components/Toast';

const STATUS_COLORS = {
  new: 'badge-blue', reviewing: 'badge-amber', shortlisted: 'badge-green',
  intro_sent: 'badge-purple', in_process: 'badge-purple', hired: 'badge-green',
  passed: 'badge-gray', dismissed: 'badge-gray',
};

export default function TalentCandidates() {
  const [candidates, setCandidates] = useState([]);
  const [stats, setStats] = useState(null);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState({ status: 'all', band: '', minScore: '', starred: false, search: '', location: '' });
  const [selected, setSelected] = useState(new Set());
  const { toast } = useToast();

  useEffect(() => { load(); }, [filter.status, filter.band, filter.minScore, filter.starred, filter.location]);
  useEffect(() => { api.getTalentCandidateStats().then(setStats).catch(() => {}); }, []);

  async function load() {
    setLoading(true);
    try {
      const params = {};
      if (filter.status !== 'all') params.status = filter.status;
      if (filter.band) params.band = filter.band;
      if (filter.minScore) params.minScore = filter.minScore;
      if (filter.starred) params.starred = 'true';
      if (filter.search) params.search = filter.search;
      if (filter.location) params.location = filter.location;
      const rows = await api.getTalentCandidates(params);
      setCandidates(rows);
    } catch (err) {
      toast({ message: err.message, tone: 'error' });
    } finally {
      setLoading(false);
    }
  }

  async function star(id, isStarred) {
    try {
      if (isStarred) await api.unstarTalentCandidate(id);
      else await api.starTalentCandidate(id);
      setCandidates(cs => cs.map(c => c.id === id ? { ...c, starred: isStarred ? 0 : 1 } : c));
    } catch (err) {
      toast({ message: err.message, tone: 'error' });
    }
  }

  async function dismiss(id) {
    try {
      await api.dismissTalentCandidate(id);
      setCandidates(cs => cs.filter(c => c.id !== id));
      toast({ message: 'Dismissed' });
    } catch (err) {
      toast({ message: err.message, tone: 'error' });
    }
  }

  function toggleSelect(id) {
    setSelected(p => { const n = new Set(p); n.has(id) ? n.delete(id) : n.add(id); return n; });
  }

  async function bulkDelete() {
    const ids = Array.from(selected);
    if (!ids.length) return;
    try {
      await api.bulkDeleteTalentCandidates(ids);
      setSelected(new Set());
      load();
      toast({
        message: `${ids.length} candidate${ids.length === 1 ? '' : 's'} deleted`,
        actionLabel: 'Undo',
        onAction: async () => { await api.restoreTalentTrash('candidate', ids); load(); },
      });
    } catch (err) {
      toast({ message: err.message, tone: 'error' });
    }
  }

  async function bulkStatus(status) {
    const ids = Array.from(selected);
    if (!ids.length) return;
    try {
      await api.bulkUpdateTalentCandidates(ids, { status });
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
          <h1 className="text-2xl font-semibold text-gray-900 tracking-tight">Candidates</h1>
          <p className="text-sm text-gray-500 mt-1">
            {stats && (
              <span>{stats.total} total · {stats.new} new · {stats.shortlisted} shortlisted · {stats.highScore} high-score</span>
            )}
          </p>
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <input
          className="input max-w-xs"
          placeholder="Search name, company, role..."
          value={filter.search}
          onChange={e => setFilter({ ...filter, search: e.target.value })}
          onKeyDown={e => e.key === 'Enter' && load()}
        />
        <select className="select" value={filter.status} onChange={e => setFilter({ ...filter, status: e.target.value })}>
          <option value="all">All status</option>
          <option value="new">New</option>
          <option value="reviewing">Reviewing</option>
          <option value="shortlisted">Shortlisted</option>
          <option value="intro_sent">Intro sent</option>
          <option value="in_process">In process</option>
          <option value="hired">Hired</option>
          <option value="passed">Passed</option>
        </select>
        <select className="select" value={filter.band} onChange={e => setFilter({ ...filter, band: e.target.value })}>
          <option value="">All bands</option>
          <option value="A">Band A</option>
          <option value="B">Band B</option>
          <option value="C">Band C</option>
        </select>
        <select className="select" value={filter.minScore} onChange={e => setFilter({ ...filter, minScore: e.target.value })}>
          <option value="">Any score</option>
          <option value="8">≥ 8</option>
          <option value="7">≥ 7</option>
          <option value="6">≥ 6</option>
        </select>
        <input
          className="input max-w-[160px]"
          placeholder="Location..."
          value={filter.location}
          onChange={e => setFilter({ ...filter, location: e.target.value })}
        />
        {(filter.location || filter.band || filter.minScore || filter.starred || filter.status !== 'all') && (
          <button
            className="text-xs text-gray-500 hover:text-gray-900 underline"
            onClick={() => setFilter({ status: 'all', band: '', minScore: '', starred: false, search: '', location: '' })}
          >
            Clear filters
          </button>
        )}
        <label className="flex items-center gap-1.5 text-sm text-gray-600">
          <input type="checkbox" checked={filter.starred} onChange={e => setFilter({ ...filter, starred: e.target.checked })} />
          Starred only
        </label>
      </div>

      {selected.size > 0 && (
        <div className="flex items-center justify-between bg-amber-50 border border-amber-200 rounded-lg px-4 py-2">
          <span className="text-sm text-amber-900">{selected.size} selected</span>
          <div className="flex gap-2">
            <button onClick={() => bulkStatus('shortlisted')} className="btn-ghost text-xs">Shortlist</button>
            <button onClick={() => bulkStatus('passed')} className="btn-ghost text-xs">Pass</button>
            <button onClick={() => setSelected(new Set())} className="btn-ghost text-xs">Clear</button>
            <button onClick={bulkDelete} className="btn-danger text-xs">Delete</button>
          </div>
        </div>
      )}

      {loading ? (
        <div className="text-sm text-gray-400">Loading...</div>
      ) : candidates.length === 0 ? (
        <div className="card p-8 text-center text-sm text-gray-400">
          No candidates yet. Run sourcing from the Home tab to start.
        </div>
      ) : (
        <div className="card overflow-hidden">
          <table className="w-full text-sm">
            <thead className="bg-gray-50 border-b border-gray-200">
              <tr>
                <th className="px-3 py-2 w-8"></th>
                <th className="px-3 py-2 w-8"></th>
                <th className="px-3 py-2 text-left font-medium text-gray-600">Candidate</th>
                <th className="px-3 py-2 text-left font-medium text-gray-600">Currently</th>
                <th className="px-3 py-2 text-left font-medium text-gray-600">Location</th>
                <th className="px-3 py-2 text-left font-medium text-gray-600">Band</th>
                <th className="px-3 py-2 text-right font-medium text-gray-600">Score</th>
                <th className="px-3 py-2 text-left font-medium text-gray-600">Status</th>
                <th className="px-3 py-2 w-8"></th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {candidates.map(c => (
                <tr key={c.id} className="hover:bg-gray-50">
                  <td className="px-3 py-2">
                    <input type="checkbox" checked={selected.has(c.id)} onChange={() => toggleSelect(c.id)} />
                  </td>
                  <td className="px-3 py-2">
                    <button onClick={() => star(c.id, !!c.starred)} className={c.starred ? 'text-amber-500' : 'text-gray-300 hover:text-amber-500'}>
                      <svg className="w-4 h-4" fill="currentColor" viewBox="0 0 24 24">
                        <path d="M12 2l2.4 7.4H22l-6.2 4.5 2.4 7.4L12 16.9l-6.2 4.4 2.4-7.4L2 9.4h7.6z"/>
                      </svg>
                    </button>
                  </td>
                  <td className="px-3 py-2">
                    <div className="flex items-center gap-1.5">
                      <Link to={`/talent/candidates/${c.id}`} className="font-medium text-gray-900 hover:text-amber-700">{c.name}</Link>
                      {c.linkedin_url && (
                        <a href={c.linkedin_url} target="_blank" rel="noopener noreferrer" title="LinkedIn" className="text-gray-300 hover:text-[#0A66C2] flex-shrink-0">
                          <svg className="w-3.5 h-3.5" fill="currentColor" viewBox="0 0 24 24"><path d="M19 3A2 2 0 0 1 21 5V19A2 2 0 0 1 19 21H5A2 2 0 0 1 3 19V5A2 2 0 0 1 5 3H19M18.5 18.5V13.2A3.26 3.26 0 0 0 15.24 9.94C14.39 9.94 13.4 10.46 12.92 11.24V10.13H10.13V18.5H12.92V13.57C12.92 12.8 13.54 12.17 14.31 12.17A1.4 1.4 0 0 1 15.71 13.57V18.5H18.5M6.88 8.56A1.68 1.68 0 0 0 8.56 6.88C8.56 5.95 7.81 5.19 6.88 5.19A1.69 1.69 0 0 0 5.19 6.88C5.19 7.81 5.95 8.56 6.88 8.56M8.27 18.5V10.13H5.5V18.5H8.27Z"/></svg>
                        </a>
                      )}
                      {c.github_url && (
                        <a href={c.github_url} target="_blank" rel="noopener noreferrer" title="GitHub" className="text-gray-300 hover:text-gray-900 flex-shrink-0">
                          <svg className="w-3.5 h-3.5" fill="currentColor" viewBox="0 0 24 24"><path d="M12 .297c-6.63 0-12 5.373-12 12 0 5.303 3.438 9.8 8.205 11.385.6.113.82-.258.82-.577 0-.285-.01-1.04-.015-2.04-3.338.724-4.042-1.61-4.042-1.61C4.422 18.07 3.633 17.7 3.633 17.7c-1.087-.744.084-.729.084-.729 1.205.084 1.838 1.236 1.838 1.236 1.07 1.835 2.809 1.305 3.495.998.108-.776.417-1.305.76-1.605-2.665-.3-5.466-1.332-5.466-5.93 0-1.31.465-2.38 1.235-3.22-.135-.303-.54-1.523.105-3.176 0 0 1.005-.322 3.3 1.23.96-.267 1.98-.399 3-.405 1.02.006 2.04.138 3 .405 2.28-1.552 3.285-1.23 3.285-1.23.645 1.653.24 2.873.12 3.176.765.84 1.23 1.91 1.23 3.22 0 4.61-2.805 5.625-5.475 5.92.42.36.81 1.096.81 2.22 0 1.606-.015 2.896-.015 3.286 0 .315.21.69.825.57C20.565 22.092 24 17.592 24 12.297c0-6.627-5.373-12-12-12"/></svg>
                        </a>
                      )}
                      {c.website_url && (
                        <a href={c.website_url} target="_blank" rel="noopener noreferrer" title="Website" className="text-gray-300 hover:text-amber-700 flex-shrink-0">
                          <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M21 12a9 9 0 01-9 9m9-9a9 9 0 00-9-9m9 9H3m9 9a9 9 0 01-9-9m9 9c2.485 0 4.5-4.03 4.5-9s-2.015-9-4.5-9m0 18c-2.485 0-4.5-4.03-4.5-9s2.015-9 4.5-9m-9 9a9 9 0 019-9" /></svg>
                        </a>
                      )}
                      {c.twitter_url && (
                        <a href={c.twitter_url} target="_blank" rel="noopener noreferrer" title="Twitter/X" className="text-gray-300 hover:text-gray-900 flex-shrink-0">
                          <svg className="w-3.5 h-3.5" fill="currentColor" viewBox="0 0 24 24"><path d="M18.244 2.25h3.308l-7.227 8.26 8.502 11.24H16.17l-5.214-6.817L4.99 21.75H1.68l7.73-8.835L1.254 2.25H8.08l4.713 6.231zm-1.161 17.52h1.833L7.084 4.126H5.117z"/></svg>
                        </a>
                      )}
                    </div>
                    {c.headline && <div className="text-xs text-gray-500 truncate max-w-[320px]">{c.headline}</div>}
                  </td>
                  <td className="px-3 py-2 text-gray-600">
                    <div className="truncate max-w-[180px]">{c.current_role || '—'}</div>
                    <div className="text-xs text-gray-400 truncate max-w-[180px]">{c.current_company || ''}</div>
                  </td>
                  <td className="px-3 py-2 text-gray-600 text-xs">{c.location_city || '—'}</td>
                  <td className="px-3 py-2 text-xs">
                    {(c.band_fit || []).map(b => <span key={b} className="badge badge-amber mr-1">{b}</span>)}
                  </td>
                  <td className="px-3 py-2 text-right tabular-nums font-medium text-gray-900">{c.overall_score ? `${c.overall_score}/10` : '—'}</td>
                  <td className="px-3 py-2"><span className={`badge ${STATUS_COLORS[c.status] || 'badge-gray'}`}>{c.status}</span></td>
                  <td className="px-3 py-2">
                    <button onClick={() => dismiss(c.id)} className="text-gray-300 hover:text-red-500" title="Dismiss">
                      <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                        <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
                      </svg>
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
