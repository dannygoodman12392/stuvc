import { useState, useEffect, useCallback } from 'react';
import { api } from '../utils/api';

const COLORS = ['gray', 'blue', 'amber', 'green', 'red', 'purple'];

const COLOR_CLASSES = {
  gray: 'bg-gray-100 text-gray-600',
  blue: 'bg-blue-50 text-blue-700',
  amber: 'bg-amber-50 text-amber-700',
  green: 'bg-emerald-50 text-emerald-700',
  red: 'bg-red-50 text-red-700',
  purple: 'bg-purple-50 text-purple-700',
};

const DEFAULT_ADMISSIONS = [
  { name: 'Sourced', color: 'gray' },
  { name: 'Outreach', color: 'blue' },
  { name: 'First Call Scheduled', color: 'blue' },
  { name: 'First Call Complete', color: 'blue' },
  { name: 'Second Call Scheduled', color: 'amber' },
  { name: 'Second Call Complete', color: 'amber' },
  { name: 'Admitted', color: 'green' },
  { name: 'Active Resident', color: 'green' },
  { name: 'Density Resident', color: 'green' },
  { name: 'Alumni', color: 'gray' },
  { name: 'Hold/Nurture', color: 'amber' },
  { name: 'Not Admitted', color: 'red' },
];

const DEFAULT_DEALS = [
  { name: 'Under Consideration', color: 'blue' },
  { name: 'First Meeting', color: 'blue' },
  { name: 'Partner Call', color: 'amber' },
  { name: 'Memo Draft', color: 'amber' },
  { name: 'IC Review', color: 'amber' },
  { name: 'Committed', color: 'green' },
  { name: 'Passed', color: 'red' },
];

const STAGE_OPTIONS = ['Pre-seed', 'Seed', 'Series A', 'Any'];

// --- Reusable Components ---

function SaveButton({ onClick, saving, saved }) {
  return (
    <div className="flex items-center gap-3">
      <button onClick={onClick} disabled={saving} className="btn-primary">
        {saving ? 'Saving...' : 'Save'}
      </button>
      {saved && <span className="text-sm text-emerald-600 font-medium animate-fade-in">Saved</span>}
    </div>
  );
}

function TagInput({ tags, onAdd, onRemove, placeholder }) {
  const [value, setValue] = useState('');

  function handleKeyDown(e) {
    if (e.key === 'Enter' && value.trim()) {
      e.preventDefault();
      const trimmed = value.trim();
      if (!tags.includes(trimmed)) {
        onAdd(trimmed);
      }
      setValue('');
    }
    if (e.key === 'Backspace' && !value && tags.length > 0) {
      onRemove(tags.length - 1);
    }
  }

  return (
    <div className="flex flex-wrap items-center gap-1.5 p-2 min-h-[42px] bg-white border border-gray-200 rounded-lg focus-within:border-blue-400 focus-within:ring-2 focus-within:ring-blue-500/10 transition-all">
      {tags.map((tag, i) => (
        <span key={i} className="inline-flex items-center gap-1 px-2.5 py-1 bg-gray-100 text-gray-700 text-sm rounded-md">
          {tag}
          <button
            type="button"
            onClick={() => onRemove(i)}
            className="text-gray-400 hover:text-gray-600 ml-0.5"
          >
            <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </span>
      ))}
      <input
        type="text"
        value={value}
        onChange={(e) => setValue(e.target.value)}
        onKeyDown={handleKeyDown}
        placeholder={tags.length === 0 ? placeholder : 'Add...'}
        className="flex-1 min-w-[120px] text-sm text-gray-900 placeholder-gray-400 outline-none bg-transparent py-1 px-1"
      />
    </div>
  );
}

function StageRow({ stage, index, total, onChange, onMove, onDelete }) {
  return (
    <div className="flex items-center gap-2 group">
      <div className="flex flex-col gap-0.5">
        <button
          type="button"
          onClick={() => onMove(index, -1)}
          disabled={index === 0}
          className="text-gray-300 hover:text-gray-500 disabled:opacity-30 disabled:cursor-default p-0.5"
          title="Move up"
        >
          <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M5 15l7-7 7 7" />
          </svg>
        </button>
        <button
          type="button"
          onClick={() => onMove(index, 1)}
          disabled={index === total - 1}
          className="text-gray-300 hover:text-gray-500 disabled:opacity-30 disabled:cursor-default p-0.5"
          title="Move down"
        >
          <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" />
          </svg>
        </button>
      </div>
      <span className="text-xs text-gray-400 w-5 text-right tabular-nums">{index + 1}</span>
      <input
        type="text"
        value={stage.name}
        onChange={(e) => onChange(index, 'name', e.target.value)}
        className="input flex-1"
        placeholder="Stage name"
      />
      <select
        value={stage.color}
        onChange={(e) => onChange(index, 'color', e.target.value)}
        className="select w-28"
      >
        {COLORS.map(c => (
          <option key={c} value={c}>{c.charAt(0).toUpperCase() + c.slice(1)}</option>
        ))}
      </select>
      <span className={`badge ${COLOR_CLASSES[stage.color]} w-16 justify-center text-[10px]`}>
        Preview
      </span>
      <button
        type="button"
        onClick={() => onDelete(index)}
        className="text-gray-300 hover:text-red-500 transition-colors p-1 opacity-0 group-hover:opacity-100"
        title="Remove stage"
      >
        <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M14.74 9l-.346 9m-4.788 0L9.26 9m9.968-3.21c.342.052.682.107 1.022.166m-1.022-.165L18.16 19.673a2.25 2.25 0 01-2.244 2.077H8.084a2.25 2.25 0 01-2.244-2.077L4.772 5.79m14.456 0a48.108 48.108 0 00-3.478-.397m-12 .562c.34-.059.68-.114 1.022-.165m0 0a48.11 48.11 0 013.478-.397m7.5 0v-.916c0-1.18-.91-2.164-2.09-2.201a51.964 51.964 0 00-3.32 0c-1.18.037-2.09 1.022-2.09 2.201v.916m7.5 0a48.667 48.667 0 00-7.5 0" />
        </svg>
      </button>
    </div>
  );
}

function CustomQueryRow({ query, index, onChange, onDelete }) {
  return (
    <div className="flex items-start gap-2 group">
      <div className="flex-1 space-y-2">
        <input
          type="text"
          value={query.name}
          onChange={(e) => onChange(index, 'name', e.target.value)}
          className="input w-full"
          placeholder="Query name (e.g., Chicago AI founders)"
        />
        <textarea
          value={query.query}
          onChange={(e) => onChange(index, 'query', e.target.value)}
          className="input w-full resize-none"
          rows={2}
          placeholder="Search query for Exa AI..."
        />
      </div>
      <button
        type="button"
        onClick={() => onDelete(index)}
        className="text-gray-300 hover:text-red-500 transition-colors p-1 mt-2 opacity-0 group-hover:opacity-100"
        title="Remove query"
      >
        <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M14.74 9l-.346 9m-4.788 0L9.26 9m9.968-3.21c.342.052.682.107 1.022.166m-1.022-.165L18.16 19.673a2.25 2.25 0 01-2.244 2.077H8.084a2.25 2.25 0 01-2.244-2.077L4.772 5.79m14.456 0a48.108 48.108 0 00-3.478-.397m-12 .562c.34-.059.68-.114 1.022-.165m0 0a48.11 48.11 0 013.478-.397m7.5 0v-.916c0-1.18-.91-2.164-2.09-2.201a51.964 51.964 0 00-3.32 0c-1.18.037-2.09 1.022-2.09 2.201v.916m7.5 0a48.667 48.667 0 00-7.5 0" />
        </svg>
      </button>
    </div>
  );
}

// --- Hook for save state ---

function useSaveState() {
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState('');

  const doSave = useCallback(async (fn) => {
    setSaving(true);
    setSaved(false);
    setError('');
    try {
      await fn();
      setSaved(true);
      setTimeout(() => setSaved(false), 2000);
    } catch (err) {
      setError(err.message || 'Failed to save');
    } finally {
      setSaving(false);
    }
  }, []);

  return { saving, saved, error, doSave, setError };
}

// --- Main Settings Page ---

export default function Settings() {
  const [loading, setLoading] = useState(true);
  const [activeTab, setActiveTab] = useState('pipeline');
  const [loadError, setLoadError] = useState('');

  // Pipeline state
  const [admissionsStages, setAdmissionsStages] = useState([]);
  const [dealStages, setDealStages] = useState([]);
  const pipelineSave = useSaveState();

  // Sourcing state
  const [locations, setLocations] = useState([]);
  const [schools, setSchools] = useState([]);
  const [companies, setCompanies] = useState([]);
  const [builderSignals, setBuilderSignals] = useState([]);
  const [domains, setDomains] = useState([]);
  const [stageFilter, setStageFilter] = useState('Pre-seed');
  const [customQueries, setCustomQueries] = useState([]);
  const sourcingSave = useSaveState();

  // API Keys state
  const [apiKeyExa, setApiKeyExa] = useState('');
  const [apiKeyAnthropic, setApiKeyAnthropic] = useState('');
  const [apiKeyEnrichlayer, setApiKeyEnrichlayer] = useState('');
  const [apiKeyGithub, setApiKeyGithub] = useState('');
  const apiKeysSave = useSaveState();

  useEffect(() => {
    async function load() {
      try {
        const settings = await api.getSettings();
        setAdmissionsStages(settings.pipeline_admissions_stages || DEFAULT_ADMISSIONS);
        setDealStages(settings.pipeline_deal_stages || DEFAULT_DEALS);
        setLocations(settings.sourcing_locations || []);
        setSchools(settings.sourcing_schools || []);
        setCompanies(settings.sourcing_companies || []);
        setBuilderSignals(settings.sourcing_builder_signals || []);
        setDomains(settings.sourcing_domains || []);
        setStageFilter(settings.sourcing_stage_filter || 'Pre-seed');
        setCustomQueries(settings.sourcing_custom_queries || []);
        setApiKeyExa(settings.api_key_exa || '');
        setApiKeyAnthropic(settings.api_key_anthropic || '');
        setApiKeyEnrichlayer(settings.api_key_enrichlayer || '');
        setApiKeyGithub(settings.api_key_github || '');
      } catch (err) {
        setLoadError(err.message || 'Failed to load settings');
      } finally {
        setLoading(false);
      }
    }
    load();
  }, []);

  // Pipeline handlers
  function updateStage(type, index, field, value) {
    const setter = type === 'admissions' ? setAdmissionsStages : setDealStages;
    setter(prev => prev.map((s, i) => i === index ? { ...s, [field]: value } : s));
  }

  function moveStage(type, index, direction) {
    const setter = type === 'admissions' ? setAdmissionsStages : setDealStages;
    setter(prev => {
      const next = [...prev];
      const target = index + direction;
      if (target < 0 || target >= next.length) return prev;
      [next[index], next[target]] = [next[target], next[index]];
      return next;
    });
  }

  function deleteStage(type, index) {
    const setter = type === 'admissions' ? setAdmissionsStages : setDealStages;
    setter(prev => prev.filter((_, i) => i !== index));
  }

  function addStage(type) {
    const setter = type === 'admissions' ? setAdmissionsStages : setDealStages;
    setter(prev => [...prev, { name: '', color: 'gray' }]);
  }

  function resetPipeline() {
    setAdmissionsStages([...DEFAULT_ADMISSIONS]);
    setDealStages([...DEFAULT_DEALS]);
  }

  async function savePipeline() {
    await pipelineSave.doSave(async () => {
      await api.updateSetting('pipeline_admissions_stages', admissionsStages);
      await api.updateSetting('pipeline_deal_stages', dealStages);
    });
  }

  // Sourcing handlers
  function addTag(setter) {
    return (tag) => setter(prev => [...prev, tag]);
  }

  function removeTag(setter) {
    return (index) => setter(prev => prev.filter((_, i) => i !== index));
  }

  function updateQuery(index, field, value) {
    setCustomQueries(prev => prev.map((q, i) => i === index ? { ...q, [field]: value } : q));
  }

  function deleteQuery(index) {
    setCustomQueries(prev => prev.filter((_, i) => i !== index));
  }

  function addQuery() {
    setCustomQueries(prev => [...prev, { name: '', query: '' }]);
  }

  async function saveSourcing() {
    await sourcingSave.doSave(async () => {
      await Promise.all([
        api.updateSetting('sourcing_locations', locations),
        api.updateSetting('sourcing_schools', schools),
        api.updateSetting('sourcing_companies', companies),
        api.updateSetting('sourcing_builder_signals', builderSignals),
        api.updateSetting('sourcing_domains', domains),
        api.updateSetting('sourcing_stage_filter', stageFilter),
        api.updateSetting('sourcing_custom_queries', customQueries),
      ]);
    });
  }

  async function saveApiKeys() {
    await apiKeysSave.doSave(async () => {
      await Promise.all([
        api.updateSetting('api_key_exa', apiKeyExa),
        api.updateSetting('api_key_anthropic', apiKeyAnthropic),
        api.updateSetting('api_key_enrichlayer', apiKeyEnrichlayer),
        api.updateSetting('api_key_github', apiKeyGithub),
      ]);
    });
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center py-20">
        <div className="text-sm text-gray-500">Loading settings...</div>
      </div>
    );
  }

  if (loadError) {
    return (
      <div className="flex items-center justify-center py-20">
        <div className="text-sm text-red-600">{loadError}</div>
      </div>
    );
  }

  const tabs = [
    { id: 'pipeline', label: 'Pipeline Stages' },
    { id: 'sourcing', label: 'Sourcing Criteria' },
    { id: 'apikeys', label: 'API Keys' },
  ];

  return (
    <div>
      <div className="mb-6">
        <h1 className="text-xl font-semibold text-gray-900">Settings</h1>
        <p className="text-sm text-gray-500 mt-1">Configure your pipeline stages and sourcing criteria.</p>
      </div>

      {/* Tabs */}
      <div className="flex gap-1 mb-6 border-b border-gray-200">
        {tabs.map(tab => (
          <button
            key={tab.id}
            onClick={() => setActiveTab(tab.id)}
            className={`px-4 py-2 text-sm font-medium border-b-2 transition-colors -mb-px ${
              activeTab === tab.id
                ? 'border-gray-900 text-gray-900'
                : 'border-transparent text-gray-500 hover:text-gray-700'
            }`}
          >
            {tab.label}
          </button>
        ))}
      </div>

      {/* Pipeline Tab */}
      {activeTab === 'pipeline' && (
        <div className="space-y-6">
          {/* Admissions Pipeline */}
          <div className="card p-6">
            <div className="mb-4">
              <h2 className="text-sm font-semibold text-gray-900">Admissions Pipeline</h2>
              <p className="text-xs text-gray-500 mt-0.5">Stages for tracking founder/resident admissions.</p>
            </div>
            <div className="space-y-2">
              {admissionsStages.map((stage, i) => (
                <StageRow
                  key={i}
                  stage={stage}
                  index={i}
                  total={admissionsStages.length}
                  onChange={(idx, field, val) => updateStage('admissions', idx, field, val)}
                  onMove={(idx, dir) => moveStage('admissions', idx, dir)}
                  onDelete={(idx) => deleteStage('admissions', idx)}
                />
              ))}
            </div>
            <button
              type="button"
              onClick={() => addStage('admissions')}
              className="btn-ghost mt-3 text-xs"
            >
              <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M12 4.5v15m7.5-7.5h-15" />
              </svg>
              Add stage
            </button>
          </div>

          {/* Deal Pipeline */}
          <div className="card p-6">
            <div className="mb-4">
              <h2 className="text-sm font-semibold text-gray-900">Deal Pipeline</h2>
              <p className="text-xs text-gray-500 mt-0.5">Stages for tracking investment deal flow.</p>
            </div>
            <div className="space-y-2">
              {dealStages.map((stage, i) => (
                <StageRow
                  key={i}
                  stage={stage}
                  index={i}
                  total={dealStages.length}
                  onChange={(idx, field, val) => updateStage('deals', idx, field, val)}
                  onMove={(idx, dir) => moveStage('deals', idx, dir)}
                  onDelete={(idx) => deleteStage('deals', idx)}
                />
              ))}
            </div>
            <button
              type="button"
              onClick={() => addStage('deals')}
              className="btn-ghost mt-3 text-xs"
            >
              <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M12 4.5v15m7.5-7.5h-15" />
              </svg>
              Add stage
            </button>
          </div>

          {/* Pipeline Actions */}
          <div className="flex items-center justify-between">
            <SaveButton onClick={savePipeline} saving={pipelineSave.saving} saved={pipelineSave.saved} />
            <button type="button" onClick={resetPipeline} className="text-xs text-gray-400 hover:text-gray-600 transition-colors">
              Reset to defaults
            </button>
          </div>
          {pipelineSave.error && (
            <p className="text-sm text-red-600 mt-2">{pipelineSave.error}</p>
          )}
        </div>
      )}

      {/* Sourcing Tab */}
      {activeTab === 'sourcing' && (
        <div className="space-y-6">
          {/* Target Locations */}
          <div className="card p-6">
            <label className="label">Target Locations</label>
            <p className="text-xs text-gray-400 mb-2">Geographic areas where you source founders. Press Enter to add.</p>
            <TagInput tags={locations} onAdd={addTag(setLocations)} onRemove={removeTag(setLocations)} placeholder="e.g., Chicago, San Francisco, Austin" />
          </div>

          {/* Target Schools */}
          <div className="card p-6">
            <label className="label">Target Schools</label>
            <p className="text-xs text-gray-400 mb-2">Schools that signal pedigree in your sourcing criteria.</p>
            <TagInput tags={schools} onAdd={addTag(setSchools)} onRemove={removeTag(setSchools)} placeholder="e.g., Northwestern, University of Chicago" />
          </div>

          {/* Target Companies */}
          <div className="card p-6">
            <label className="label">Target Companies</label>
            <p className="text-xs text-gray-400 mb-2">Companies whose alumni you want to track (ex-Google, ex-Stripe, etc).</p>
            <TagInput tags={companies} onAdd={addTag(setCompanies)} onRemove={removeTag(setCompanies)} placeholder="e.g., Google, Stripe, OpenAI" />
          </div>

          {/* Builder Signals */}
          <div className="card p-6">
            <label className="label">Builder Signals</label>
            <p className="text-xs text-gray-400 mb-2">Signals that indicate strong founder potential.</p>
            <TagInput tags={builderSignals} onAdd={addTag(setBuilderSignals)} onRemove={removeTag(setBuilderSignals)} placeholder="e.g., YC Alum, Previous Exit, Serial Founder" />
          </div>

          {/* Focus Domains */}
          <div className="card p-6">
            <label className="label">Focus Domains</label>
            <p className="text-xs text-gray-400 mb-2">Industry verticals you invest in.</p>
            <TagInput tags={domains} onAdd={addTag(setDomains)} onRemove={removeTag(setDomains)} placeholder="e.g., AI/ML, Fintech, Health Tech" />
          </div>

          {/* Stage Filter */}
          <div className="card p-6">
            <label className="label">Stage Filter</label>
            <p className="text-xs text-gray-400 mb-2">Preferred funding stage for sourcing.</p>
            <select
              value={stageFilter}
              onChange={(e) => setStageFilter(e.target.value)}
              className="select w-48"
            >
              {STAGE_OPTIONS.map(opt => (
                <option key={opt} value={opt}>{opt}</option>
              ))}
            </select>
          </div>

          {/* Custom Search Queries */}
          <div className="card p-6">
            <div className="mb-3">
              <label className="label">Custom Search Queries</label>
              <p className="text-xs text-gray-400">Advanced Exa AI queries for specialized sourcing.</p>
            </div>
            {customQueries.length > 0 && (
              <div className="space-y-3 mb-3">
                {customQueries.map((q, i) => (
                  <CustomQueryRow
                    key={i}
                    query={q}
                    index={i}
                    onChange={updateQuery}
                    onDelete={deleteQuery}
                  />
                ))}
              </div>
            )}
            <button type="button" onClick={addQuery} className="btn-ghost text-xs">
              <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M12 4.5v15m7.5-7.5h-15" />
              </svg>
              Add query
            </button>
          </div>

          {/* Sourcing Actions */}
          <div className="flex items-center">
            <SaveButton onClick={saveSourcing} saving={sourcingSave.saving} saved={sourcingSave.saved} />
          </div>
          {sourcingSave.error && (
            <p className="text-sm text-red-600 mt-2">{sourcingSave.error}</p>
          )}
        </div>
      )}

      {/* API Keys Tab */}
      {activeTab === 'apikeys' && (
        <div className="space-y-6">
          <div className="card p-6">
            <div className="mb-4">
              <h2 className="text-sm font-semibold text-gray-900">API Integrations</h2>
              <p className="text-xs text-gray-500 mt-0.5">
                Provide your own API keys to power sourcing, scoring, and enrichment. Keys are stored securely and never shared.
              </p>
            </div>

            <div className="space-y-5">
              {/* Exa */}
              <div>
                <div className="flex items-center gap-2 mb-1">
                  <label className="label mb-0">Exa API Key</label>
                  <span className="text-[10px] font-medium text-red-500 bg-red-50 px-1.5 py-0.5 rounded">Required</span>
                </div>
                <p className="text-xs text-gray-400 mb-2">
                  Powers founder discovery and web search.{' '}
                  <a href="https://exa.ai" target="_blank" rel="noopener noreferrer" className="text-blue-500 hover:text-blue-600">
                    Get a key →
                  </a>
                </p>
                <input
                  type="password"
                  value={apiKeyExa}
                  onChange={(e) => setApiKeyExa(e.target.value)}
                  className="input w-full"
                  placeholder="exa-..."
                  autoComplete="off"
                />
              </div>

              {/* Anthropic */}
              <div>
                <div className="flex items-center gap-2 mb-1">
                  <label className="label mb-0">Anthropic API Key</label>
                  <span className="text-[10px] font-medium text-red-500 bg-red-50 px-1.5 py-0.5 rounded">Required</span>
                </div>
                <p className="text-xs text-gray-400 mb-2">
                  Powers AI scoring, assessments, and Ask Stu.{' '}
                  <a href="https://console.anthropic.com/settings/keys" target="_blank" rel="noopener noreferrer" className="text-blue-500 hover:text-blue-600">
                    Get a key →
                  </a>
                </p>
                <input
                  type="password"
                  value={apiKeyAnthropic}
                  onChange={(e) => setApiKeyAnthropic(e.target.value)}
                  className="input w-full"
                  placeholder="sk-ant-..."
                  autoComplete="off"
                />
              </div>

              {/* EnrichLayer */}
              <div>
                <div className="flex items-center gap-2 mb-1">
                  <label className="label mb-0">EnrichLayer API Key</label>
                  <span className="text-[10px] font-medium text-gray-500 bg-gray-100 px-1.5 py-0.5 rounded">Optional</span>
                </div>
                <p className="text-xs text-gray-400 mb-2">
                  Enriches founder profiles with email, company, and social data.{' '}
                  <a href="https://enrichlayer.com" target="_blank" rel="noopener noreferrer" className="text-blue-500 hover:text-blue-600">
                    Get a key →
                  </a>
                </p>
                <input
                  type="password"
                  value={apiKeyEnrichlayer}
                  onChange={(e) => setApiKeyEnrichlayer(e.target.value)}
                  className="input w-full"
                  placeholder="el-..."
                  autoComplete="off"
                />
              </div>

              {/* GitHub */}
              <div>
                <div className="flex items-center gap-2 mb-1">
                  <label className="label mb-0">GitHub Token</label>
                  <span className="text-[10px] font-medium text-gray-500 bg-gray-100 px-1.5 py-0.5 rounded">Optional</span>
                </div>
                <p className="text-xs text-gray-400 mb-2">
                  Increases GitHub API rate limits for builder signal detection.{' '}
                  <a href="https://github.com/settings/tokens" target="_blank" rel="noopener noreferrer" className="text-blue-500 hover:text-blue-600">
                    Create a token →
                  </a>
                </p>
                <input
                  type="password"
                  value={apiKeyGithub}
                  onChange={(e) => setApiKeyGithub(e.target.value)}
                  className="input w-full"
                  placeholder="ghp_..."
                  autoComplete="off"
                />
              </div>
            </div>
          </div>

          {/* Info callout */}
          <div className="bg-blue-50 border border-blue-100 rounded-xl p-4 flex gap-3">
            <svg className="w-5 h-5 text-blue-500 flex-shrink-0 mt-0.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M11.25 11.25l.041-.02a.75.75 0 011.063.852l-.708 2.836a.75.75 0 001.063.853l.041-.021M21 12a9 9 0 11-18 0 9 9 0 0118 0zm-9-3.75h.008v.008H12V8.25z" />
            </svg>
            <div>
              <p className="text-sm font-medium text-blue-900">Why do I need my own keys?</p>
              <p className="text-xs text-blue-700 mt-1 leading-relaxed">
                Sourcing, scoring, and enrichment use external APIs that bill by usage. By providing your own keys, you control costs and get direct access to your usage dashboards. Exa and Anthropic are required to run the sourcing engine.
              </p>
            </div>
          </div>

          {/* API Keys Actions */}
          <div className="flex items-center">
            <SaveButton onClick={saveApiKeys} saving={apiKeysSave.saving} saved={apiKeysSave.saved} />
          </div>
          {apiKeysSave.error && (
            <p className="text-sm text-red-600 mt-2">{apiKeysSave.error}</p>
          )}
        </div>
      )}
    </div>
  );
}
