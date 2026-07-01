import { useState, useEffect, useCallback, useMemo } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../utils/api';
import KanbanBoard from '../components/KanbanBoard';
import ImportFoundersModal from '../components/ImportFoundersModal';
import { PageHeader, FilterBar, FilterSelect, SearchInput, RankedList, Row, Score, Tag, DetailPanel, DetailSection, EmptyState } from '../components/ui';

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

// Sift filters for the Sourced inbox.
const SOURCE_LABELS = {
  yc_directory: 'Y Combinator', a16z_speedrun: 'a16z Speedrun', z_fellows: 'Z Fellows',
  neo_scholars: 'Neo', thiel_fellows: 'Thiel Fellows', the_residency: 'The Residency',
  emergent_ventures: 'Emergent Ventures', uspto_trademark: 'Trademark filings', discovery: 'Web discovery',
};
const PROGRAM_OPTIONS = Object.entries(SOURCE_LABELS).map(([value, label]) => ({ value, label }));
const TIE_OPTIONS = [
  { value: 'current', label: 'In Chicago now' },
  { value: 'school_alumni', label: 'IL school' },
  { value: 'hometown', label: 'From IL' },
  { value: 'working', label: 'Works/worked here' },
  { value: 'chicago_company', label: 'Ex-Chicago co.' },
];
const SCHOOL_OPTIONS = [
  { value: 'all', label: 'Any school' },
  { value: 'uchicago', label: 'UChicago' },
  { value: 'northwestern', label: 'Northwestern' },
  { value: 'uiuc', label: 'U of I (UIUC)' },
  { value: 'iit', label: 'Illinois Tech' },
  { value: 'loyola', label: 'Loyola' },
  { value: 'depaul', label: 'DePaul' },
];

export default function Pipeline() {
  const [tab, setTab] = useState('sourced');
  const [founders, setFounders] = useState([]);
  const [sourcedQueue, setSourcedQueue] = useState([]);
  const [sourcedStarred, setSourcedStarred] = useState([]);
  const [stats, setStats] = useState(null);
  const [sourcingStats, setSourcingStats] = useState(null);
  const [filter, setFilter] = useState({ status: '', search: '', minScore: '', caliber: '', source: [], tieType: [], school: '', scope: 'pipeline' });
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
        if (filter.caliber) params.caliber = filter.caliber;
        if (filter.source?.length) params.source = filter.source.join(',');
        if (filter.tieType?.length) params.tieType = filter.tieType.join(',');
        if (filter.school) params.school = filter.school;
        if (filter.scope && filter.scope !== 'pipeline') params.scope = filter.scope;
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

  // R7: permanent-hide (dismissed rows with do_not_resurface=1 never come back)
  async function handleHideForever(id) {
    if (!confirm('Hide this candidate permanently? They will never re-surface in future sourcing runs.')) return;
    try {
      await api.hideForeverSourced(id);
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
      <PageHeader
        title="Pipeline"
        count={stats?.total}
        subtitle="The best current pre-seed & stealth builders with verified Chicago/Illinois ties — ranked by caliber × fit."
        actions={
          <>
            {tab === 'sourced' && (
              <button onClick={handleTriggerSourcing} disabled={sourcingRunning} className="btn-primary text-sm disabled:opacity-50">
                {sourcingRunning ? 'Sourcing…' : 'Find founders'}
              </button>
            )}
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
            <button onClick={() => setShowImportModal(true)} className="btn-secondary text-sm">Import</button>
            <Link to="/founders/new" className="btn-secondary text-sm">Add founder</Link>
          </>
        }
      />

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
          onHideForever={handleHideForever}
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

function InboxTab({ queue, starred, stats, loading, onApprove, onDismiss, onHideForever, onStar, onUnstar, onTriggerSourcing, sourcingRunning, filter, setFilter }) {
  const [selectedId, setSelectedId] = useState(null);
  const parseArr = (s) => { try { const v = JSON.parse(s || '[]'); return Array.isArray(v) ? v : []; } catch { return []; } };

  if (loading) return <div className="text-center py-16 text-sm text-gray-400">Loading…</div>;

  const list = queue;
  const idx = list.findIndex(f => f.id === selectedId);
  const selected = idx >= 0 ? list[idx] : null;
  const go = (n) => { const t = list[n]; if (t) setSelectedId(t.id); };

  const tieLabel = (f) => {
    const t = (f.location_type || '').replace(/_/g, ' ');
    return f.chicago_connection || (t ? t : null);
  };

  const advance = (id) => { onApprove(id); if (id === selectedId) { const next = list[idx + 1]; setSelectedId(next ? next.id : null); } };
  const pass = (id) => { onDismiss(id); if (id === selectedId) { const next = list[idx + 1]; setSelectedId(next ? next.id : null); } };

  return (
    <div>
      <div className="flex items-center gap-1 mb-3 bg-gray-100 rounded-lg p-1 w-fit">
        {[{ v: 'pipeline', l: 'Chicago Pipeline' }, { v: 'watchlist', l: 'Frontier Watch · national' }].map(o => (
          <button key={o.v} onClick={() => setFilter(f => ({ ...f, scope: o.v }))}
            className={`px-3 py-1.5 text-sm rounded-md transition-colors ${(filter.scope || 'pipeline') === o.v ? 'bg-white text-gray-900 shadow-sm' : 'text-gray-500 hover:text-gray-700'}`}>
            {o.l}
          </button>
        ))}
      </div>
      <FilterBar resultCount={list.length} dirty={!!(filter.caliber || filter.minScore || filter.search || filter.source?.length || filter.tieType?.length || filter.school)} onClearAll={() => setFilter(f => ({ ...f, search: '', minScore: '', caliber: '', source: [], tieType: [], school: '' }))}>
        <div className="w-64"><SearchInput value={filter.search} onChange={(v) => setFilter(f => ({ ...f, search: v }))} placeholder="Name, company, school…" /></div>
        <FilterSelect label="Program" multi value={filter.source || []} onChange={(v) => setFilter(f => ({ ...f, source: v }))} options={PROGRAM_OPTIONS} />
        {(filter.scope || 'pipeline') === 'pipeline' && (
          <FilterSelect label="School" value={filter.school || 'all'} onChange={(v) => setFilter(f => ({ ...f, school: v === 'all' ? '' : v }))} options={SCHOOL_OPTIONS} />
        )}
        {(filter.scope || 'pipeline') === 'pipeline' && (
          <FilterSelect label="Tie" multi value={filter.tieType || []} onChange={(v) => setFilter(f => ({ ...f, tieType: v }))} options={TIE_OPTIONS} />
        )}
        <FilterSelect label="Caliber" value={filter.caliber || 'all'} onChange={(v) => setFilter(f => ({ ...f, caliber: v === 'all' ? '' : v }))}
          options={[{ value: 'all', label: 'All tiers' }, { value: 'S', label: 'S only' }, { value: 'A', label: 'A & above' }, { value: 'B', label: 'B & above' }]} />
        <FilterSelect label="Fit" value={filter.minScore || 'all'} onChange={(v) => setFilter(f => ({ ...f, minScore: v === 'all' ? '' : v }))}
          options={[{ value: 'all', label: 'Any fit' }, { value: '8', label: '8+ (high conviction)' }, { value: '6', label: '6+ (worth a look)' }]} />
        {starred.length > 0 && (
          <FilterSelect label="View" value="pending" onChange={() => {}} options={[{ value: 'pending', label: `Pending (${queue.length})` }, { value: 'starred', label: `Starred (${starred.length})` }]} />
        )}
      </FilterBar>

      {stats?.learning?.likedN >= 3 && (
        <p className="text-xs text-gray-400 mb-3">Learning from your taste · {stats.learning.likedN} advanced, {stats.learning.passedN} passed. A <span className="inline-block w-2 h-2 rounded-full bg-danger align-middle" /> marks a founder that runs counter to your usual pattern.</p>
      )}

      <RankedList
        items={list}
        emptyState={<EmptyState title="No founders match" description="Broaden the caliber or fit filter, or run sourcing to pull fresh builders." action={{ label: sourcingRunning ? 'Sourcing…' : 'Find founders now', onClick: onTriggerSourcing }} />}
        renderRow={(f) => (
          <Row
            key={f.id}
            tier={f.caliber_tier || 'C'}
            title={f.name}
            subtitle={f.company ? `${f.company}${f.company_one_liner ? ' — ' + f.company_one_liner : ''}` : (f.company_one_liner || 'Stealth')}
            meta={<>{tieLabel(f) && <Tag>{tieLabel(f)}</Tag>}{parseArr(f.tags).slice(0, 1).map((t, i) => <Tag key={i}>{t}</Tag>)}</>}
            score={<Score value={f.confidence_score} max={10} label="Fit" />}
            flag={(f.affinity_score ?? 0) < 0}
            selected={f.id === selectedId}
            onClick={() => setSelectedId(f.id)}
            trailing={
              <div className="flex items-center gap-1">
                {f.linkedin_url && (
                  <a href={f.linkedin_url} target="_blank" rel="noopener" onClick={(e) => e.stopPropagation()}
                    className="text-xs font-medium px-2 py-1 rounded-md border border-gray-200 text-gray-600 hover:border-accent hover:text-accent" title="Open LinkedIn">in ↗</a>
                )}
                <span className="flex items-center gap-1 opacity-0 group-hover:opacity-100">
                  <button onClick={(e) => { e.stopPropagation(); advance(f.id); }} className="text-xs font-medium px-2 py-1 rounded-md bg-accent text-white hover:bg-accent-hover">Advance</button>
                  <button onClick={(e) => { e.stopPropagation(); pass(f.id); }} className="text-xs font-medium px-2 py-1 rounded-md text-danger hover:bg-danger-soft border border-gray-200">Pass</button>
                </span>
              </div>
            }
          />
        )}
      />

      {selected && (
        <DetailPanel
          open={!!selected}
          onClose={() => setSelectedId(null)}
          title={selected.name}
          subtitle={selected.company ? `${selected.company}${selected.confidence_score ? ` · Fit ${selected.confidence_score}/10` : ''}` : 'Stealth'}
          onPrev={idx > 0 ? () => go(idx - 1) : null}
          onNext={idx < list.length - 1 ? () => go(idx + 1) : null}
          primaryAction={{ label: 'Advance to pipeline', onClick: () => advance(selected.id), tone: 'accent' }}
          secondaryActions={[
            { label: 'Pass', onClick: () => pass(selected.id), tone: 'danger' },
            ...(onStar ? [{ label: 'Star', onClick: () => onStar(selected.id) }] : []),
          ]}
        >
          <div className="flex items-center gap-3 mb-5">
            {selected.linkedin_url && <a href={selected.linkedin_url} target="_blank" rel="noopener" className="text-sm font-medium text-accent hover:text-accent-hover">LinkedIn ↗</a>}
            {selected.github_url && <a href={selected.github_url} target="_blank" rel="noopener" className="text-sm font-medium text-accent hover:text-accent-hover">GitHub ↗</a>}
            {selected.website && <a href={selected.website} target="_blank" rel="noopener" className="text-sm font-medium text-accent hover:text-accent-hover">Website ↗</a>}
          </div>

          {tieLabel(selected) && (
            <DetailSection label="Chicago / Illinois tie">
              {selected.chicago_connection || tieLabel(selected)}
              {selected.location_type && <span className="text-gray-400"> · {selected.location_type.replace(/_/g, ' ')}</span>}
            </DetailSection>
          )}
          {(() => {
            let ev = {}; try { ev = JSON.parse(selected.evidence_map || '{}') || {}; } catch {}
            const quotes = [['Tie', ev.tie_evidence], ['Caliber', ev.caliber_evidence], ['Stage', ev.stage_evidence]].filter(([, q]) => q && String(q).trim());
            if (!quotes.length) return null;
            return (
              <DetailSection label="Verbatim evidence (from their profile)">
                <div className="space-y-1.5">
                  {quotes.map(([k, q], i) => (
                    <div key={i} className="text-xs text-gray-600 border-l-2 border-gray-200 pl-2">
                      <span className="text-gray-400">{k}: </span>“{String(q).slice(0, 240)}”
                    </div>
                  ))}
                </div>
              </DetailSection>
            );
          })()}
          {selected.company_one_liner && <DetailSection label="What they're building">{selected.company_one_liner}</DetailSection>}
          {parseArr(selected.caliber_signals).length > 0 && (
            <DetailSection label="Why this caliber">
              <div className="flex flex-wrap gap-1.5">{parseArr(selected.caliber_signals).map((s, i) => <Tag key={i}>{s}</Tag>)}</div>
            </DetailSection>
          )}
          {parseArr(selected.builder_signals).length > 0 && (
            <DetailSection label="Builder signals">
              <div className="flex flex-wrap gap-1.5">{parseArr(selected.builder_signals).map((s, i) => <Tag key={i}>{s}</Tag>)}</div>
            </DetailSection>
          )}
          {parseArr(selected.pedigree_signals).length > 0 && (
            <DetailSection label="Background">
              <div className="flex flex-wrap gap-1.5">{parseArr(selected.pedigree_signals).map((s, i) => <Tag key={i}>{s}</Tag>)}</div>
            </DetailSection>
          )}
          {parseArr(selected.red_flags).length > 0 && (
            <DetailSection label="Watch-outs">
              <ul className="list-disc pl-4 space-y-1 text-gray-600">{parseArr(selected.red_flags).map((s, i) => <li key={i}>{s}</li>)}</ul>
            </DetailSection>
          )}
          {(selected.affinity_score ?? 0) < 0 && (
            <div className="rounded-lg border border-danger/30 bg-danger-soft px-3 py-2 mt-2">
              <p className="text-xs font-semibold text-danger">Counter to your usual pattern</p>
              <p className="text-xs text-gray-600 mt-0.5">This founder doesn't match the signals you typically advance — worth a deliberate look at why they might still be right.</p>
            </div>
          )}
        </DetailPanel>
      )}
    </div>
  );
}

// ── Inbox Card (rich founder preview) ──
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
