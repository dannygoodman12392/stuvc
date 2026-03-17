import { useState, useEffect } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../utils/api';

const RELATIONSHIP_STATUSES = ['All', 'Identified', 'Contacted', 'Meeting Scheduled', 'Met', 'Passed'];
const DEAL_STATUSES = ['All', 'Under Consideration', 'Active Diligence', 'IC Review', 'Committed', 'Passed'];
const RESIDENT_STATUSES = ['All', 'Prospect', 'Tour Scheduled', 'Admitted', 'Active', 'Alumni'];

const STATUS_COLORS = {
  'Identified': 'badge-gray', 'Contacted': 'badge-blue', 'Meeting Scheduled': 'badge-blue',
  'Met': 'badge-green', 'Passed': 'badge-red',
};
const DEAL_COLORS = {
  'Under Consideration': 'badge-blue', 'Active Diligence': 'badge-amber',
  'IC Review': 'badge-amber', 'Committed': 'badge-green', 'Passed': 'badge-red',
};
const RESIDENT_COLORS = {
  'Prospect': 'badge-gray', 'Tour Scheduled': 'badge-blue',
  'Admitted': 'badge-green', 'Active': 'badge-green', 'Alumni': 'badge-gray',
};

export default function Pipeline() {
  const [tab, setTab] = useState('all');
  const [founders, setFounders] = useState([]);
  const [sourcedQueue, setSourcedQueue] = useState([]);
  const [stats, setStats] = useState(null);
  const [filter, setFilter] = useState({ status: '', search: '' });
  const [loading, setLoading] = useState(true);

  useEffect(() => { loadData(); }, [tab, filter]);

  async function loadData() {
    setLoading(true);
    try {
      if (tab === 'sourced') {
        const [q, s] = await Promise.all([api.getSourcingQueue(), api.getFounderStats()]);
        setSourcedQueue(q);
        setStats(s);
      } else {
        const params = {};
        if (filter.search) params.search = filter.search;
        if (tab === 'residents') {
          params.track = 'resident';
          if (filter.status && filter.status !== 'All') params.resident_status = filter.status;
        } else if (tab === 'investments') {
          params.track = 'investment';
          if (filter.status && filter.status !== 'All') params.deal_status = filter.status;
        } else {
          if (filter.status && filter.status !== 'All') params.status = filter.status;
        }
        const [f, s] = await Promise.all([api.getFounders(params), api.getFounderStats()]);
        setFounders(f);
        setStats(s);
      }
    } catch (err) {
      console.error(err);
    }
    setLoading(false);
  }

  async function handleApprove(id) {
    try {
      await api.approveSourced(id);
      setSourcedQueue(q => q.filter(f => f.id !== id));
    } catch (err) { console.error(err); }
  }

  async function handleDismiss(id) {
    try {
      await api.dismissSourced(id);
      setSourcedQueue(q => q.filter(f => f.id !== id));
    } catch (err) { console.error(err); }
  }

  const statusOptions = tab === 'residents' ? RESIDENT_STATUSES : tab === 'investments' ? DEAL_STATUSES : RELATIONSHIP_STATUSES;

  return (
    <div>
      {/* Header */}
      <div className="flex items-center justify-between mb-4 md:mb-6">
        <div>
          <h1 className="text-lg md:text-xl font-bold text-gray-900">Pipeline</h1>
          <p className="text-xs md:text-sm text-gray-500 mt-0.5">
            {stats ? `${stats.total} founders` : 'Loading...'}
            {stats?.residents > 0 && <span className="ml-1 md:ml-2">· {stats.residents} residents</span>}
            {stats?.investments > 0 && <span className="ml-1 md:ml-2 hidden sm:inline">· {stats.investments} in investment pipeline</span>}
          </p>
        </div>
        <Link to="/founders/new" className="btn-primary text-xs md:text-sm">
          <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M12 4.5v15m7.5-7.5h-15" />
          </svg>
          <span className="hidden sm:inline">Add Founder</span>
          <span className="sm:hidden">Add</span>
        </Link>
      </div>

      {/* Tabs */}
      <div className="flex gap-1 mb-4 md:mb-6 bg-gray-100 rounded-lg p-1 w-full md:w-fit overflow-x-auto scrollbar-hide">
        {[
          { key: 'sourced', label: 'Sourced', badge: stats?.sourcedPending },
          { key: 'all', label: 'All Founders' },
          { key: 'residents', label: 'Residents' },
          { key: 'investments', label: 'Investment Pipeline' },
        ].map(t => (
          <button
            key={t.key}
            onClick={() => { setTab(t.key); setFilter({ status: '', search: '' }); }}
            className={`px-3 md:px-4 py-1.5 rounded-md text-xs md:text-sm font-medium transition-colors flex items-center gap-1.5 md:gap-2 whitespace-nowrap ${
              tab === t.key ? 'bg-white text-gray-900 shadow-sm' : 'text-gray-500 hover:text-gray-700'
            }`}
          >
            {t.label}
            {t.badge > 0 && (
              <span className="bg-blue-600 text-white text-[10px] font-bold px-1.5 py-0.5 rounded-full">{t.badge}</span>
            )}
          </button>
        ))}
      </div>

      {tab === 'sourced' ? (
        <SourcedTab queue={sourcedQueue} loading={loading} onApprove={handleApprove} onDismiss={handleDismiss} />
      ) : (
        <>
          {/* Filters */}
          <div className="flex flex-col sm:flex-row gap-2 sm:gap-3 mb-4">
            <input
              type="text"
              placeholder="Search founders..."
              value={filter.search}
              onChange={e => setFilter(f => ({ ...f, search: e.target.value }))}
              className="input text-sm w-full sm:w-64"
            />
            <select
              value={filter.status}
              onChange={e => setFilter(f => ({ ...f, status: e.target.value }))}
              className="select text-sm"
            >
              {statusOptions.map(s => <option key={s} value={s === 'All' ? '' : s}>{s}</option>)}
            </select>
          </div>

          {/* Stats bar */}
          {stats && tab === 'all' && (
            <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-6">
              {stats.byStatus.slice(0, 4).map(s => (
                <div key={s.status} className="card px-4 py-3">
                  <p className="text-xs text-gray-500 uppercase tracking-wider">{s.status}</p>
                  <p className="text-xl font-bold text-gray-900 mt-1">{s.count}</p>
                </div>
              ))}
            </div>
          )}

          {stats && tab === 'investments' && stats.byDealStatus?.length > 0 && (
            <div className="grid grid-cols-2 md:grid-cols-5 gap-3 mb-6">
              {stats.byDealStatus.map(s => (
                <div key={s.deal_status} className="card px-4 py-3">
                  <p className="text-xs text-gray-500 uppercase tracking-wider">{s.deal_status}</p>
                  <p className="text-xl font-bold text-gray-900 mt-1">{s.count}</p>
                </div>
              ))}
            </div>
          )}

          {stats && tab === 'residents' && stats.byResidentStatus?.length > 0 && (
            <div className="grid grid-cols-2 md:grid-cols-5 gap-3 mb-6">
              {stats.byResidentStatus.map(s => (
                <div key={s.resident_status} className="card px-4 py-3">
                  <p className="text-xs text-gray-500 uppercase tracking-wider">{s.resident_status}</p>
                  <p className="text-xl font-bold text-gray-900 mt-1">{s.count}</p>
                </div>
              ))}
            </div>
          )}

          {/* Founder list */}
          {loading ? (
            <div className="text-center py-12 text-gray-500 text-sm">Loading...</div>
          ) : founders.length === 0 ? (
            <div className="text-center py-12">
              <p className="text-gray-500 text-sm">
                {tab === 'residents' ? 'No residents yet' : tab === 'investments' ? 'No investment pipeline founders yet' : 'No founders yet'}
              </p>
              <Link to="/founders/new" className="text-blue-600 text-sm mt-2 inline-block hover:underline">Add your first founder</Link>
            </div>
          ) : (
            <div className="space-y-2">
              {founders.map(f => (
                <FounderRow key={f.id} founder={f} tab={tab} />
              ))}
            </div>
          )}
        </>
      )}
    </div>
  );
}

function FounderRow({ founder: f, tab }) {
  const tracks = (f.pipeline_tracks || '').split(',').filter(Boolean);
  const showDeal = tab === 'investments';
  const showResident = tab === 'residents';

  return (
    <Link to={`/founders/${f.id}`} className="card-hover block px-4 py-3">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3 min-w-0">
          <div className="w-9 h-9 rounded-full bg-gray-100 flex items-center justify-center text-sm font-bold text-gray-600 flex-shrink-0">
            {f.name?.split(' ').map(n => n[0]).join('').slice(0, 2)}
          </div>
          <div className="min-w-0">
            <div className="flex items-center gap-2">
              <p className="text-sm font-medium text-gray-900 truncate">{f.name}</p>
              {/* Track badges */}
              {!showDeal && !showResident && tracks.length > 0 && (
                <div className="flex gap-1">
                  {tracks.includes('resident') && (
                    <span className="text-[9px] font-semibold px-1.5 py-0.5 rounded bg-purple-50 text-purple-600 uppercase tracking-wider">Resident</span>
                  )}
                  {tracks.includes('investment') && (
                    <span className="text-[9px] font-semibold px-1.5 py-0.5 rounded bg-emerald-50 text-emerald-600 uppercase tracking-wider">Investment</span>
                  )}
                </div>
              )}
            </div>
            <p className="text-xs text-gray-500 truncate">
              {f.company && <span>{f.company}</span>}
              {f.company && (f.company_one_liner || f.domain) && <span> · </span>}
              {f.company_one_liner ? <span>{f.company_one_liner}</span> : f.domain && <span>{f.domain}</span>}
            </p>
          </div>
        </div>
        <div className="flex items-center gap-3 flex-shrink-0">
          {f.fit_score && (
            <div className={`text-sm font-bold ${f.fit_score >= 8 ? 'text-emerald-600' : f.fit_score >= 6 ? 'text-amber-600' : 'text-gray-400'}`}>
              {f.fit_score}/10
            </div>
          )}
          {showDeal && f.deal_status ? (
            <span className={`badge ${DEAL_COLORS[f.deal_status] || 'badge-gray'}`}>{f.deal_status}</span>
          ) : showResident && f.resident_status ? (
            <span className={`badge ${RESIDENT_COLORS[f.resident_status] || 'badge-gray'}`}>{f.resident_status}</span>
          ) : (
            <span className={`badge ${STATUS_COLORS[f.status] || 'badge-gray'}`}>{f.status}</span>
          )}
        </div>
      </div>
      {/* Investment row extras */}
      {showDeal && (f.valuation || f.round_size || f.arr) && (
        <div className="flex gap-4 mt-2 ml-12 text-xs text-gray-400">
          {f.valuation && <span>Val: ${formatCurrency(f.valuation)}</span>}
          {f.round_size && <span>Round: ${formatCurrency(f.round_size)}</span>}
          {f.arr && <span>ARR: ${formatCurrency(f.arr)}</span>}
          {f.deal_lead && <span>Lead: {f.deal_lead}</span>}
        </div>
      )}
      {/* Resident row extras */}
      {showResident && (f.desks_needed || f.admitted_at) && (
        <div className="flex gap-4 mt-2 ml-12 text-xs text-gray-400">
          {f.desks_needed && <span>{f.desks_needed} desk{f.desks_needed > 1 ? 's' : ''}</span>}
          {f.admitted_at && <span>Admitted {new Date(f.admitted_at).toLocaleDateString()}</span>}
        </div>
      )}
    </Link>
  );
}

function SourcedTab({ queue, loading, onApprove, onDismiss }) {
  if (loading) return <div className="text-center py-12 text-gray-500 text-sm">Loading sourced founders...</div>;
  if (queue.length === 0) {
    return (
      <div className="text-center py-12">
        <p className="text-gray-500 text-sm">No pending sourced founders</p>
        <p className="text-xs text-gray-400 mt-1">The sourcing engine runs daily at 6am CT</p>
      </div>
    );
  }
  return (
    <div className="space-y-2">
      {queue.map(f => (
        <div key={f.id} className="card px-4 py-3">
          <div className="flex items-start justify-between gap-4">
            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-2 mb-1">
                <p className="text-sm font-medium text-gray-900">{f.name}</p>
                {f.company && <span className="text-xs text-gray-500">{f.company}</span>}
              </div>
              <div className="flex items-center gap-2 mb-2">
                <span className="badge badge-blue text-[10px]">{f.source}</span>
                <span className={`text-sm font-bold ${f.confidence_score >= 8 ? 'text-emerald-600' : f.confidence_score >= 6 ? 'text-amber-600' : 'text-gray-400'}`}>
                  {f.confidence_score}/10
                </span>
              </div>
              {f.confidence_rationale && (
                <p className="text-xs text-gray-500 line-clamp-2">{f.confidence_rationale}</p>
              )}
            </div>
            <div className="flex gap-2 flex-shrink-0">
              <button onClick={() => onApprove(f.id)} className="btn-primary text-xs px-3 py-1.5">Approve</button>
              <button onClick={() => onDismiss(f.id)} className="btn-ghost text-xs px-3 py-1.5 text-gray-500">Dismiss</button>
            </div>
          </div>
        </div>
      ))}
    </div>
  );
}

function formatCurrency(n) {
  if (!n) return '';
  if (n >= 1e9) return (n / 1e9).toFixed(1) + 'B';
  if (n >= 1e6) return (n / 1e6).toFixed(1) + 'M';
  if (n >= 1e3) return (n / 1e3).toFixed(0) + 'K';
  return n.toLocaleString();
}
