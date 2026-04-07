import { useState, useEffect, useCallback, useMemo } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../utils/api';
import KanbanBoard from '../components/KanbanBoard';
import ImportFoundersModal from '../components/ImportFoundersModal';

// Fallback defaults — used when pipeline config API is unavailable
const DEFAULT_ADMISSIONS_STATUSES = ['All', 'Sourced', 'Outreach', 'First Call Scheduled', 'First Call Complete', 'Second Call Scheduled', 'Second Call Complete', 'Admitted', 'Active Resident', 'Density Resident', 'Alumni', 'Hold/Nurture', 'Not Admitted'];
const DEFAULT_DEAL_STATUSES = ['All', 'Under Consideration', 'First Meeting', 'Partner Call', 'Memo Draft', 'IC Review', 'Committed', 'Passed'];

const DEFAULT_ADMISSIONS_PIPELINE_STAGES = ['Sourced', 'Outreach', 'First Call Scheduled', 'First Call Complete', 'Second Call Scheduled', 'Second Call Complete', 'Admitted', 'Active Resident', 'Density Resident', 'Alumni', 'Hold/Nurture', 'Not Admitted'];
const DEFAULT_DEAL_PIPELINE_STAGES = ['Under Consideration', 'First Meeting', 'Partner Call', 'Memo Draft', 'IC Review', 'Committed', 'Passed'];

const DEFAULT_ADMISSIONS_COLORS = {
  'Sourced': 'badge-gray', 'Outreach': 'badge-blue',
  'First Call Scheduled': 'badge-blue', 'First Call Complete': 'badge-blue',
  'Second Call Scheduled': 'badge-amber', 'Second Call Complete': 'badge-amber',
  'Admitted': 'badge-green', 'Active Resident': 'badge-green', 'Density Resident': 'badge-green',
  'Alumni': 'badge-gray', 'Hold/Nurture': 'badge-amber', 'Not Admitted': 'badge-red',
};
const DEFAULT_DEAL_COLORS = {
  'Under Consideration': 'badge-blue', 'First Meeting': 'badge-blue',
  'Partner Call': 'badge-amber', 'Memo Draft': 'badge-amber',
  'IC Review': 'badge-amber', 'Committed': 'badge-green', 'Passed': 'badge-red',
};
const STATUS_COLORS = {
  'Sourced': 'badge-gray', 'Outreach': 'badge-blue', 'Interviewing': 'badge-blue',
  'Active': 'badge-green', 'Hold': 'badge-amber', 'Passed': 'badge-red',
  'Not Admitted': 'badge-red', 'Inactive': 'badge-gray',
};

export default function Pipeline() {
  const [tab, setTab] = useState('sourced');
  const [founders, setFounders] = useState([]);
  const [sourcedQueue, setSourcedQueue] = useState([]);
  const [sourcedStarred, setSourcedStarred] = useState([]);
  const [stats, setStats] = useState(null);
  const [sourcingStats, setSourcingStats] = useState(null);
  const [filter, setFilter] = useState({ status: '', search: '', minScore: '' });
  const [loading, setLoading] = useState(true);
  const [viewMode, setViewMode] = useState(() => localStorage.getItem('pipeline_view') || 'list');
  const [sourcingRunning, setSourcingRunning] = useState(false);
  const [showImportModal, setShowImportModal] = useState(false);
  const [pipelineConfig, setPipelineConfig] = useState(null);

  useEffect(() => {
    api.getPipelineConfig()
      .then(config => setPipelineConfig(config))
      .catch(() => {}); // silently fall back to defaults
  }, []);

  const admissionsStatuses = useMemo(() => {
    if (pipelineConfig?.admissions_stages) {
      return ['All', ...pipelineConfig.admissions_stages.map(s => s.name)];
    }
    return DEFAULT_ADMISSIONS_STATUSES;
  }, [pipelineConfig]);

  const admissionsPipelineStages = useMemo(() => {
    if (pipelineConfig?.admissions_stages) {
      return pipelineConfig.admissions_stages.map(s => s.name);
    }
    return DEFAULT_ADMISSIONS_PIPELINE_STAGES;
  }, [pipelineConfig]);

  const admissionsColors = useMemo(() => {
    if (pipelineConfig?.admissions_stages) {
      const colors = {};
      pipelineConfig.admissions_stages.forEach(s => {
        colors[s.name] = `badge-${s.color}`;
      });
      return colors;
    }
    return DEFAULT_ADMISSIONS_COLORS;
  }, [pipelineConfig]);

  const dealStatuses = useMemo(() => {
    if (pipelineConfig?.deal_stages) {
      return ['All', ...pipelineConfig.deal_stages.map(s => s.name)];
    }
    return DEFAULT_DEAL_STATUSES;
  }, [pipelineConfig]);

  const dealPipelineStages = useMemo(() => {
    if (pipelineConfig?.deal_stages) {
      return pipelineConfig.deal_stages.map(s => s.name);
    }
    return DEFAULT_DEAL_PIPELINE_STAGES;
  }, [pipelineConfig]);

  const dealColors = useMemo(() => {
    if (pipelineConfig?.deal_stages) {
      const colors = {};
      pipelineConfig.deal_stages.forEach(s => {
        colors[s.name] = `badge-${s.color}`;
      });
      return colors;
    }
    return DEFAULT_DEAL_COLORS;
  }, [pipelineConfig]);

  useEffect(() => { loadData(); }, [tab, filter]);
  useEffect(() => { localStorage.setItem('pipeline_view', viewMode); }, [viewMode]);

  async function loadData() {
    setLoading(true);
    try {
      if (tab === 'sourced') {
        const params = {};
        if (filter.search) params.search = filter.search;
        if (filter.minScore) params.minScore = filter.minScore;
        const [q, starred, ss, s] = await Promise.all([
          api.getSourcingQueue(params),
          api.getSourcingStarred(),
          api.getSourcingStats(),
          api.getFounderStats()
        ]);
        setSourcedQueue(q);
        setSourcedStarred(starred);
        setSourcingStats(ss);
        setStats(s);
      } else {
        const params = {};
        if (filter.search) params.search = filter.search;
        if (tab === 'admissions') {
          params.track = 'admissions';
          if (filter.status && filter.status !== 'All') params.admissions_status = filter.status;
        } else if (tab === 'investment') {
          params.track = 'investment';
          if (filter.status && filter.status !== 'All') params.deal_status = filter.status;
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
      setSourcedStarred(q => q.filter(f => f.id !== id));
    } catch (err) { console.error(err); }
  }

  async function handleDismiss(id) {
    try {
      await api.dismissSourced(id);
      setSourcedQueue(q => q.filter(f => f.id !== id));
      setSourcedStarred(q => q.filter(f => f.id !== id));
    } catch (err) { console.error(err); }
  }

  async function handleStar(id) {
    try {
      await api.starSourced(id);
      const item = sourcedQueue.find(f => f.id === id);
      setSourcedQueue(q => q.filter(f => f.id !== id));
      if (item) setSourcedStarred(s => [{ ...item, status: 'starred' }, ...s]);
    } catch (err) { console.error(err); }
  }

  async function handleUnstar(id) {
    try {
      await api.unstarSourced(id);
      const item = sourcedStarred.find(f => f.id === id);
      setSourcedStarred(s => s.filter(f => f.id !== id));
      if (item) setSourcedQueue(q => [{ ...item, status: 'pending' }, ...q]);
    } catch (err) { console.error(err); }
  }

  async function handleTriggerSourcing() {
    setSourcingRunning(true);
    try {
      await api.triggerSourcing();
      // Reload after a brief delay to show new results
      setTimeout(() => { loadData(); setSourcingRunning(false); }, 3000);
    } catch (err) {
      console.error(err);
      setSourcingRunning(false);
    }
  }

  async function handleStageChange(founderId, newStage) {
    const field = tab === 'investment' ? 'deal_status' : 'admissions_status';
    setFounders(prev => prev.map(f => f.id === founderId ? { ...f, [field]: newStage } : f));
    try {
      await api.updateFounder(founderId, { [field]: newStage });
    } catch (err) {
      console.error('Stage update failed:', err);
      loadData();
    }
  }

  async function handleAddToInvestment(founderId) {
    const founder = founders.find(f => f.id === founderId);
    if (!founder) return;
    const tracks = (founder.pipeline_tracks || '').split(',').filter(Boolean);
    if (tracks.includes('investment')) return;
    tracks.push('investment');
    setFounders(prev => prev.map(f => f.id === founderId ? { ...f, pipeline_tracks: tracks.join(','), deal_status: 'Under Consideration' } : f));
    try {
      await api.updateFounder(founderId, { pipeline_tracks: tracks.join(','), deal_status: 'Under Consideration' });
    } catch (err) {
      console.error(err);
      loadData();
    }
  }

  const statusOptions = tab === 'admissions' ? admissionsStatuses : tab === 'investment' ? dealStatuses : [];
  const showKanban = viewMode === 'kanban' && (tab === 'admissions' || tab === 'investment');

  return (
    <div>
      {/* Header */}
      <div className="flex items-center justify-between mb-4 md:mb-6">
        <div>
          <h1 className="text-lg md:text-xl font-bold text-gray-900">Pipeline</h1>
          <p className="text-xs md:text-sm text-gray-500 mt-0.5">
            {stats ? `${stats.total} founders` : 'Loading...'}
            {stats?.admissions > 0 && <span className="ml-1 md:ml-2">· {stats.admissions} in admissions</span>}
            {stats?.investments > 0 && <span className="ml-1 md:ml-2 hidden sm:inline">· {stats.investments} in investment pipeline</span>}
          </p>
        </div>
        <div className="flex items-center gap-2">
          {(tab === 'admissions' || tab === 'investment') && (
            <div className="flex bg-gray-100 rounded-lg p-0.5">
              <button onClick={() => setViewMode('list')} className={`p-1.5 rounded-md transition-colors ${viewMode === 'list' ? 'bg-white shadow-sm text-gray-900' : 'text-gray-400 hover:text-gray-600'}`} title="List view">
                <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M3.75 12h16.5m-16.5 3.75h16.5M3.75 19.5h16.5M5.625 4.5h12.75a1.875 1.875 0 010 3.75H5.625a1.875 1.875 0 010-3.75z" /></svg>
              </button>
              <button onClick={() => setViewMode('kanban')} className={`p-1.5 rounded-md transition-colors ${viewMode === 'kanban' ? 'bg-white shadow-sm text-gray-900' : 'text-gray-400 hover:text-gray-600'}`} title="Board view">
                <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M9 4.5v15m6-15v15m-10.875 0h15.75c.621 0 1.125-.504 1.125-1.125V5.625c0-.621-.504-1.125-1.125-1.125H4.125C3.504 4.5 3 5.004 3 5.625v12.75c0 .621.504 1.125 1.125 1.125z" /></svg>
              </button>
            </div>
          )}
          <button onClick={() => setShowImportModal(true)} className="btn-ghost text-xs md:text-sm border border-gray-200">
            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M3 16.5v2.25A2.25 2.25 0 005.25 21h13.5A2.25 2.25 0 0021 18.75V16.5m-13.5-9L12 3m0 0l4.5 4.5M12 3v13.5" /></svg>
            <span className="hidden sm:inline">Import</span>
          </button>
          <Link to="/founders/new" className="btn-primary text-xs md:text-sm">
            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M12 4.5v15m7.5-7.5h-15" /></svg>
            <span className="hidden sm:inline">Add Founder</span>
            <span className="sm:hidden">Add</span>
          </Link>
        </div>
      </div>

      {/* Tabs */}
      <div className="flex gap-1 mb-4 md:mb-6 bg-gray-100 rounded-lg p-1 w-full md:w-fit overflow-x-auto scrollbar-hide">
        {[
          { key: 'sourced', label: 'Inbox', badge: sourcingStats?.pending || stats?.sourcedPending },
          { key: 'admissions', label: 'Admissions Pipeline' },
          { key: 'investment', label: 'Investment Pipeline' },
        ].map(t => (
          <button
            key={t.key}
            onClick={() => { setTab(t.key); setFilter({ status: '', search: '', minScore: '' }); }}
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
        <InboxTab
          queue={sourcedQueue}
          starred={sourcedStarred}
          stats={sourcingStats}
          loading={loading}
          onApprove={handleApprove}
          onDismiss={handleDismiss}
          onStar={handleStar}
          onUnstar={handleUnstar}
          onTriggerSourcing={handleTriggerSourcing}
          sourcingRunning={sourcingRunning}
          filter={filter}
          setFilter={setFilter}
        />
      ) : (
        <>
          {!showKanban && (
            <div className="flex flex-col sm:flex-row gap-2 sm:gap-3 mb-4">
              <input type="text" placeholder="Search founders..." value={filter.search} onChange={e => setFilter(f => ({ ...f, search: e.target.value }))} className="input text-sm w-full sm:w-64" />
              <select value={filter.status} onChange={e => setFilter(f => ({ ...f, status: e.target.value }))} className="select text-sm">
                {statusOptions.map(s => <option key={s} value={s === 'All' ? '' : s}>{s}</option>)}
              </select>
            </div>
          )}

          {!showKanban && stats && tab === 'admissions' && stats.byAdmissionsStatus?.length > 0 && (
            <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-6 gap-3 mb-6">
              {stats.byAdmissionsStatus.map(s => (
                <button key={s.admissions_status} onClick={() => setFilter(f => ({ ...f, status: f.status === s.admissions_status ? '' : s.admissions_status }))}
                  className={`card px-3 py-2.5 text-left transition-colors cursor-pointer ${filter.status === s.admissions_status ? 'ring-2 ring-blue-500 bg-blue-50' : 'hover:bg-gray-50'}`}>
                  <p className="text-[10px] text-gray-500 uppercase tracking-wider truncate">{s.admissions_status}</p>
                  <p className="text-lg font-bold text-gray-900 mt-0.5">{s.count}</p>
                </button>
              ))}
            </div>
          )}

          {!showKanban && stats && tab === 'investment' && stats.byDealStatus?.length > 0 && (
            <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-7 gap-3 mb-6">
              {stats.byDealStatus.map(s => (
                <button key={s.deal_status} onClick={() => setFilter(f => ({ ...f, status: f.status === s.deal_status ? '' : s.deal_status }))}
                  className={`card px-3 py-2.5 text-left transition-colors cursor-pointer ${filter.status === s.deal_status ? 'ring-2 ring-blue-500 bg-blue-50' : 'hover:bg-gray-50'}`}>
                  <p className="text-[10px] text-gray-500 uppercase tracking-wider truncate">{s.deal_status}</p>
                  <p className="text-lg font-bold text-gray-900 mt-0.5">{s.count}</p>
                </button>
              ))}
            </div>
          )}

          {loading ? (
            <div className="text-center py-12 text-gray-500 text-sm">Loading...</div>
          ) : showKanban ? (
            <KanbanBoard founders={founders} stages={tab === 'admissions' ? admissionsPipelineStages : dealPipelineStages} track={tab} onStageChange={handleStageChange} onAddToInvestment={handleAddToInvestment} />
          ) : founders.length === 0 ? (
            <div className="text-center py-12">
              <p className="text-gray-500 text-sm">{tab === 'admissions' ? 'No founders in admissions pipeline yet' : 'No founders in investment pipeline yet'}</p>
              <Link to="/founders/new" className="text-blue-600 text-sm mt-2 inline-block hover:underline">Add your first founder</Link>
            </div>
          ) : (
            <div className="space-y-2">
              {founders.map(f => <FounderRow key={f.id} founder={f} tab={tab} admissionsColors={admissionsColors} dealColors={dealColors} />)}
            </div>
          )}
        </>
      )}
      {showImportModal && (
        <ImportFoundersModal
          onClose={() => setShowImportModal(false)}
          onImportComplete={loadData}
        />
      )}
    </div>
  );
}

// ── Inbox Tab (redesigned sourcing inbox) ──

function InboxTab({ queue, starred, stats, loading, onApprove, onDismiss, onStar, onUnstar, onTriggerSourcing, sourcingRunning, filter, setFilter }) {
  const [showStarred, setShowStarred] = useState(false);

  if (loading) return <div className="text-center py-12 text-gray-500 text-sm">Loading...</div>;

  const highScorers = queue.filter(f => f.confidence_score >= 8);
  const medScorers = queue.filter(f => f.confidence_score >= 6 && f.confidence_score < 8);
  const lowScorers = queue.filter(f => f.confidence_score < 6);

  return (
    <div>
      {/* Inbox header stats */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 mb-5">
        <div className="flex items-center gap-4">
          {stats?.todayAdded > 0 && (
            <div className="flex items-center gap-1.5">
              <div className="w-2 h-2 rounded-full bg-green-400 animate-pulse" />
              <span className="text-sm font-medium text-gray-700">{stats.todayAdded} new today</span>
            </div>
          )}
          <span className="text-xs text-gray-400">{queue.length} pending · {stats?.approved || 0} approved · {stats?.dismissed || 0} dismissed</span>
          {stats?.lastRun && (
            <span className="text-xs text-gray-400 hidden md:inline">Last run: {new Date(stats.lastRun.run_at).toLocaleDateString()}</span>
          )}
        </div>
        <div className="flex items-center gap-2">
          {starred.length > 0 && (
            <button onClick={() => setShowStarred(!showStarred)} className={`text-xs px-3 py-1.5 rounded-md border transition-colors ${showStarred ? 'bg-amber-50 border-amber-200 text-amber-700' : 'border-gray-200 text-gray-500 hover:bg-gray-50'}`}>
              <span className="mr-1">&#9733;</span> Starred ({starred.length})
            </button>
          )}
          <button onClick={onTriggerSourcing} disabled={sourcingRunning} className="btn-primary text-xs px-3 py-1.5 disabled:opacity-50">
            {sourcingRunning ? (
              <span className="flex items-center gap-1.5"><span className="w-3 h-3 border-2 border-white border-t-transparent rounded-full animate-spin" /> Running...</span>
            ) : (
              <span className="flex items-center gap-1.5">
                <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M16.023 9.348h4.992v-.001M2.985 19.644v-4.992m0 0h4.992m-4.993 0l3.181 3.183a8.25 8.25 0 0013.803-3.7M4.031 9.865a8.25 8.25 0 0113.803-3.7l3.181 3.182" /></svg>
                Find Founders
              </span>
            )}
          </button>
        </div>
      </div>

      {/* Filters */}
      <div className="flex flex-col sm:flex-row gap-2 sm:gap-3 mb-4">
        <input type="text" placeholder="Search inbox..." value={filter.search} onChange={e => setFilter(f => ({ ...f, search: e.target.value }))} className="input text-sm w-full sm:w-64" />
        <select value={filter.minScore} onChange={e => setFilter(f => ({ ...f, minScore: e.target.value }))} className="select text-sm">
          <option value="">All scores</option>
          <option value="8">8+ (High conviction)</option>
          <option value="6">6+ (Worth reviewing)</option>
        </select>
      </div>

      {/* Starred section */}
      {showStarred && starred.length > 0 && (
        <div className="mb-6">
          <h3 className="text-sm font-semibold text-amber-700 mb-3 flex items-center gap-1.5">
            <span>&#9733;</span> Starred for Review ({starred.length})
          </h3>
          <div className="space-y-3">
            {starred.map(f => (
              <InboxCard key={f.id} founder={f} onApprove={onApprove} onDismiss={onDismiss} onStar={null} onUnstar={onUnstar} />
            ))}
          </div>
        </div>
      )}

      {/* High conviction (8+) */}
      {highScorers.length > 0 && (
        <div className="mb-6">
          <h3 className="text-sm font-semibold text-gray-700 mb-3 flex items-center gap-2">
            <span className="w-2 h-2 rounded-full bg-emerald-500" />
            High Conviction ({highScorers.length})
            <span className="text-[10px] font-normal text-gray-400">Score 8+</span>
          </h3>
          <div className="space-y-3">
            {highScorers.map(f => (
              <InboxCard key={f.id} founder={f} onApprove={onApprove} onDismiss={onDismiss} onStar={onStar} onUnstar={null} />
            ))}
          </div>
        </div>
      )}

      {/* Medium (6-7) */}
      {medScorers.length > 0 && (
        <div className="mb-6">
          <h3 className="text-sm font-semibold text-gray-700 mb-3 flex items-center gap-2">
            <span className="w-2 h-2 rounded-full bg-amber-400" />
            Worth Reviewing ({medScorers.length})
            <span className="text-[10px] font-normal text-gray-400">Score 6-7</span>
          </h3>
          <div className="space-y-3">
            {medScorers.map(f => (
              <InboxCard key={f.id} founder={f} onApprove={onApprove} onDismiss={onDismiss} onStar={onStar} onUnstar={null} />
            ))}
          </div>
        </div>
      )}

      {/* Low (<6) */}
      {lowScorers.length > 0 && (
        <div className="mb-6">
          <details>
            <summary className="text-sm font-semibold text-gray-400 mb-3 cursor-pointer flex items-center gap-2">
              <span className="w-2 h-2 rounded-full bg-gray-300" />
              Lower Fit ({lowScorers.length})
              <span className="text-[10px] font-normal">Score &lt;6 — click to expand</span>
            </summary>
            <div className="space-y-3 mt-3">
              {lowScorers.map(f => (
                <InboxCard key={f.id} founder={f} onApprove={onApprove} onDismiss={onDismiss} onStar={onStar} onUnstar={null} compact />
              ))}
            </div>
          </details>
        </div>
      )}

      {/* Empty state */}
      {queue.length === 0 && starred.length === 0 && (
        <div className="text-center py-16">
          <div className="text-4xl mb-3">&#128269;</div>
          <h3 className="text-sm font-semibold text-gray-700 mb-1">No founders in your inbox</h3>
          <p className="text-xs text-gray-400 mb-4">The sourcing engine runs daily at 6 AM CT, or you can trigger a run manually.</p>
          <button onClick={onTriggerSourcing} disabled={sourcingRunning} className="btn-primary text-xs">
            Find Founders Now
          </button>
        </div>
      )}
    </div>
  );
}

// ── Inbox Card (rich founder preview) ──

function InboxCard({ founder: f, onApprove, onDismiss, onStar, onUnstar, compact }) {
  const [expanded, setExpanded] = useState(false);

  let tags = [];
  let pedigree = [];
  let builder = [];
  try { tags = JSON.parse(f.tags || '[]'); } catch {}
  try { pedigree = JSON.parse(f.pedigree_signals || '[]'); } catch {}
  try { builder = JSON.parse(f.builder_signals || '[]'); } catch {}

  const scoreColor = f.confidence_score >= 8 ? 'text-emerald-600 bg-emerald-50 border-emerald-200'
    : f.confidence_score >= 6 ? 'text-amber-600 bg-amber-50 border-amber-200'
    : 'text-gray-500 bg-gray-50 border-gray-200';

  const scoreRing = f.confidence_score >= 8 ? 'ring-emerald-100'
    : f.confidence_score >= 6 ? 'ring-amber-100'
    : 'ring-gray-100';

  if (compact) {
    return (
      <div className={`card px-4 py-3 ring-1 ${scoreRing}`}>
        <div className="flex items-center justify-between gap-3">
          <div className="flex items-center gap-3 min-w-0">
            <div className={`w-9 h-9 rounded-full flex items-center justify-center text-sm font-bold border flex-shrink-0 ${scoreColor}`}>
              {f.confidence_score}
            </div>
            <div className="min-w-0">
              <p className="text-sm font-medium text-gray-900 truncate">{f.name}</p>
              <p className="text-xs text-gray-500 truncate">{f.company || f.company_one_liner || 'Stealth'}{f.chicago_connection ? ` · ${f.chicago_connection}` : ''}</p>
            </div>
          </div>
          <div className="flex items-center gap-1.5 flex-shrink-0">
            {f.linkedin_url && (
              <a href={f.linkedin_url} target="_blank" rel="noopener" onClick={e => e.stopPropagation()} className="text-[9px] font-medium px-1.5 py-0.5 rounded border border-blue-200 text-blue-600 hover:bg-blue-50">LI</a>
            )}
            <button onClick={() => onApprove(f.id)} className="text-[10px] font-medium px-2 py-1 rounded bg-emerald-50 text-emerald-700 hover:bg-emerald-100 border border-emerald-200">Add</button>
            <button onClick={() => onDismiss(f.id)} className="text-[10px] font-medium px-2 py-1 rounded text-gray-400 hover:bg-gray-50 border border-gray-200">Skip</button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className={`card ring-1 ${scoreRing} overflow-hidden`}>
      <div className="px-4 py-3.5">
        {/* Top row */}
        <div className="flex items-start justify-between gap-3">
          <div className="flex items-start gap-3 min-w-0">
            <div className={`w-11 h-11 rounded-xl flex items-center justify-center text-lg font-bold border flex-shrink-0 ${scoreColor}`}>
              {f.confidence_score}
            </div>
            <div className="min-w-0">
              <div className="flex items-center gap-2 mb-0.5">
                <p className="text-sm font-semibold text-gray-900">{f.name}</p>
                {f.source && (
                  <span className="text-[9px] font-medium px-1.5 py-0.5 rounded bg-gray-100 text-gray-500 uppercase">{f.source}</span>
                )}
              </div>
              {f.company && <p className="text-xs font-medium text-gray-700">{f.company}</p>}
              {f.company_one_liner && <p className="text-xs text-gray-500 mt-0.5">{f.company_one_liner}</p>}
            </div>
          </div>

          {/* Actions */}
          <div className="flex items-center gap-1.5 flex-shrink-0">
            {f.linkedin_url && (
              <a href={f.linkedin_url} target="_blank" rel="noopener" onClick={e => e.stopPropagation()}
                className="text-xs font-medium px-2.5 py-1.5 rounded-md border border-blue-200 text-blue-600 hover:bg-blue-50 transition-colors">
                LinkedIn
              </a>
            )}
            {f.github_url && (
              <a href={f.github_url} target="_blank" rel="noopener" onClick={e => e.stopPropagation()}
                className="text-xs font-medium px-2.5 py-1.5 rounded-md border border-gray-200 text-gray-600 hover:bg-gray-50 transition-colors">
                GitHub
              </a>
            )}
          </div>
        </div>

        {/* Chicago connection */}
        {f.chicago_connection && (
          <div className="mt-2.5 flex items-center gap-1.5">
            <svg className="w-3.5 h-3.5 text-blue-500 flex-shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M15 10.5a3 3 0 11-6 0 3 3 0 016 0z" /><path strokeLinecap="round" strokeLinejoin="round" d="M19.5 10.5c0 7.142-7.5 11.25-7.5 11.25S4.5 17.642 4.5 10.5a7.5 7.5 0 1115 0z" /></svg>
            <span className="text-xs text-blue-700 font-medium">{f.chicago_connection}</span>
            {f.location_type && (
              <span className="text-[9px] px-1.5 py-0.5 rounded bg-blue-50 text-blue-500 uppercase">{f.location_type.replace('_', ' ')}</span>
            )}
          </div>
        )}

        {/* Signal badges */}
        {(pedigree.length > 0 || builder.length > 0 || tags.length > 0) && (
          <div className="flex flex-wrap gap-1.5 mt-2.5">
            {pedigree.map(p => (
              <span key={p} className="text-[10px] font-medium px-2 py-0.5 rounded-full bg-purple-50 text-purple-700 border border-purple-100">{p}</span>
            ))}
            {builder.map(b => (
              <span key={b} className="text-[10px] font-medium px-2 py-0.5 rounded-full bg-emerald-50 text-emerald-700 border border-emerald-100">{b}</span>
            ))}
            {tags.filter(t => !['Chicago', 'Illinois', 'Pre-seed', 'Seed'].includes(t)).slice(0, 4).map(t => (
              <span key={t} className="text-[10px] font-medium px-2 py-0.5 rounded-full bg-gray-50 text-gray-600 border border-gray-200">{t}</span>
            ))}
          </div>
        )}

        {/* Rationale */}
        {f.confidence_rationale && (
          <p className="text-xs text-gray-500 mt-2.5 leading-relaxed">{f.confidence_rationale}</p>
        )}

        {/* Expand for more */}
        {f.headline && (
          <button onClick={() => setExpanded(!expanded)} className="text-[10px] text-gray-400 mt-2 hover:text-gray-600">
            {expanded ? 'Show less' : 'Show full headline'}
          </button>
        )}
        {expanded && f.headline && (
          <p className="text-xs text-gray-400 mt-1 italic">{f.headline}</p>
        )}
      </div>

      {/* Action bar */}
      <div className="flex items-center justify-between px-4 py-2.5 bg-gray-50 border-t border-gray-100">
        <div className="flex items-center gap-2">
          <button onClick={() => onApprove(f.id)}
            className="text-xs font-semibold px-3.5 py-1.5 rounded-md bg-emerald-600 text-white hover:bg-emerald-700 transition-colors shadow-sm">
            Add to Pipeline
          </button>
          {onStar && (
            <button onClick={() => onStar(f.id)}
              className="text-xs font-medium px-3 py-1.5 rounded-md border border-amber-200 text-amber-600 hover:bg-amber-50 transition-colors">
              &#9733; Star
            </button>
          )}
          {onUnstar && (
            <button onClick={() => onUnstar(f.id)}
              className="text-xs font-medium px-3 py-1.5 rounded-md border border-gray-200 text-gray-500 hover:bg-gray-50 transition-colors">
              Unstar
            </button>
          )}
        </div>
        <button onClick={() => onDismiss(f.id)}
          className="text-xs font-medium px-3 py-1.5 rounded-md text-gray-400 hover:text-red-500 hover:bg-red-50 transition-colors">
          Skip
        </button>
      </div>
    </div>
  );
}

// ── Founder Row (list view for pipeline tabs) ──

function FounderRow({ founder: f, tab, admissionsColors = DEFAULT_ADMISSIONS_COLORS, dealColors = DEFAULT_DEAL_COLORS }) {
  const tracks = (f.pipeline_tracks || '').split(',').filter(Boolean);
  const showDeal = tab === 'investment';
  const showAdmissions = tab === 'admissions';

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
              {!showDeal && !showAdmissions && tracks.length > 0 && (
                <div className="flex gap-1">
                  {tracks.includes('admissions') && <span className="text-[9px] font-semibold px-1.5 py-0.5 rounded bg-purple-50 text-purple-600 uppercase tracking-wider">Admissions</span>}
                  {tracks.includes('investment') && <span className="text-[9px] font-semibold px-1.5 py-0.5 rounded bg-emerald-50 text-emerald-600 uppercase tracking-wider">Investment</span>}
                </div>
              )}
              {showAdmissions && tracks.includes('investment') && <span className="text-[9px] font-semibold px-1.5 py-0.5 rounded bg-emerald-50 text-emerald-600 uppercase tracking-wider">+Investment</span>}
              {showDeal && tracks.includes('admissions') && <span className="text-[9px] font-semibold px-1.5 py-0.5 rounded bg-purple-50 text-purple-600 uppercase tracking-wider">+Admissions</span>}
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
            <div className={`text-sm font-bold ${f.fit_score >= 8 ? 'text-emerald-600' : f.fit_score >= 6 ? 'text-amber-600' : 'text-gray-400'}`}>{f.fit_score}/10</div>
          )}
          {showDeal && f.deal_status ? (
            <span className={`badge ${dealColors[f.deal_status] || 'badge-gray'}`}>{f.deal_status}</span>
          ) : showAdmissions && f.admissions_status ? (
            <span className={`badge ${admissionsColors[f.admissions_status] || 'badge-gray'}`}>{f.admissions_status}</span>
          ) : (
            <span className={`badge ${STATUS_COLORS[f.status] || 'badge-gray'}`}>{f.status}</span>
          )}
        </div>
      </div>
      {showDeal && (f.valuation || f.round_size || f.arr) && (
        <div className="flex gap-4 mt-2 ml-12 text-xs text-gray-400">
          {f.valuation && <span>Val: ${formatCurrency(f.valuation)}</span>}
          {f.round_size && <span>Round: ${formatCurrency(f.round_size)}</span>}
          {f.arr && <span>ARR: ${formatCurrency(f.arr)}</span>}
          {f.deal_lead && <span>Lead: {f.deal_lead}</span>}
        </div>
      )}
      {f.next_action && (
        <div className="mt-1.5 ml-12 text-xs text-gray-400 truncate">Next: {f.next_action}</div>
      )}
    </Link>
  );
}

function formatCurrency(n) {
  if (!n) return '';
  if (n >= 1e9) return (n / 1e9).toFixed(1) + 'B';
  if (n >= 1e6) return (n / 1e6).toFixed(1) + 'M';
  if (n >= 1e3) return (n / 1e3).toFixed(0) + 'K';
  return n.toLocaleString();
}
