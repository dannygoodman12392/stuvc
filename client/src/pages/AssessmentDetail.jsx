import { useState, useEffect, useRef } from 'react';
import { useParams, Link, useNavigate } from 'react-router-dom';
import { api } from '../utils/api';

const AGENTS = [
  { key: 'founder', label: 'Founder', field: 'founder_agent_output' },
  { key: 'market', label: 'Market', field: 'market_agent_output' },
  { key: 'economics', label: 'Economics', field: 'economics_agent_output' },
  { key: 'pattern', label: 'Pattern', field: 'pattern_agent_output' },
  { key: 'bear', label: 'Bear', field: 'bear_agent_output' },
];

const TABS = [
  { key: 'synthesis', label: 'Synthesis' },
  ...AGENTS.map(a => ({ key: a.key, label: a.label })),
  { key: 'inputs', label: 'Materials' },
];

export default function AssessmentDetail() {
  const { id } = useParams();
  const navigate = useNavigate();
  const [assessment, setAssessment] = useState(null);
  const [loading, setLoading] = useState(true);
  const [activeTab, setActiveTab] = useState('synthesis');
  const [versions, setVersions] = useState([]);
  const [inputs, setInputs] = useState([]);
  const [showVersions, setShowVersions] = useState(false);
  const pollRef = useRef(null);

  useEffect(() => {
    loadAssessment();
    return () => { if (pollRef.current) clearInterval(pollRef.current); };
  }, [id]);

  async function loadAssessment() {
    try {
      const a = await api.getAssessment(id);
      setAssessment(a);

      // Load inputs
      api.getAssessmentInputs(id).then(setInputs).catch(() => {});

      // Load version history if group_id exists
      if (a.group_id) {
        api.getAssessmentGroup(a.group_id).then(setVersions).catch(() => {});
      }

      // Poll if running
      if (a.status === 'running' || a.status === 'synthesizing' || a.status === 'processing_inputs') {
        pollRef.current = setInterval(async () => {
          try {
            const updated = await api.getAssessment(id);
            setAssessment(updated);
            if (['complete', 'partial', 'error', 'cancelled'].includes(updated.status)) {
              clearInterval(pollRef.current);
              // Reload versions
              if (updated.group_id) api.getAssessmentGroup(updated.group_id).then(setVersions).catch(() => {});
            }
          } catch {}
        }, 3000);
      }
    } catch (err) {
      console.error(err);
    }
    setLoading(false);
  }

  function parseOutput(jsonStr) {
    if (!jsonStr) return null;
    try { return JSON.parse(jsonStr); } catch { return null; }
  }

  async function handleCancel() {
    try {
      await api.cancelAssessment(id);
      setAssessment(a => ({ ...a, status: 'cancelled' }));
      if (pollRef.current) clearInterval(pollRef.current);
    } catch (err) {
      alert('Failed to cancel: ' + err.message);
    }
  }

  async function handleDelete() {
    if (!confirm('Delete this assessment? This cannot be undone.')) return;
    try {
      await api.deleteAssessment(id);
      navigate('/assess');
    } catch (err) {
      alert('Failed to delete: ' + err.message);
    }
  }

  function handleRerun() {
    const params = new URLSearchParams({ rerun: id });
    if (assessment.group_id) params.set('group', assessment.group_id);
    navigate(`/assess?${params.toString()}`);
  }

  if (loading) return <div className="text-center py-12 text-gray-500 text-sm">Loading assessment...</div>;
  if (!assessment) return <div className="text-center py-12 text-gray-500 text-sm">Assessment not found</div>;

  const synthesis = parseOutput(assessment.synthesis_output);
  const isRunning = ['running', 'synthesizing', 'processing_inputs'].includes(assessment.status);
  const isComplete = assessment.status === 'complete' || assessment.status === 'partial';

  const SIGNAL_COLORS = {
    'Strong Pass': 'text-emerald-600',
    'Pass': 'text-blue-600',
    'Watch': 'text-amber-600',
    'Pass On': 'text-red-600',
  };

  return (
    <div className="flex gap-6">
      {/* Main content */}
      <div className="flex-1 min-w-0">
        {/* Breadcrumb */}
        <div className="flex items-center gap-2 text-sm text-gray-400 mb-4">
          <Link to="/assess" className="hover:text-gray-600">Assess</Link>
          <span>/</span>
          <span className="text-gray-700">{assessment.founder_name || `Assessment #${id}`}</span>
          {assessment.version_number > 1 && <span className="badge badge-gray text-[10px]">v{assessment.version_number}</span>}
        </div>

        {/* Header */}
        <div className="flex items-start justify-between mb-4">
          <div>
            <h1 className="text-xl font-bold text-gray-900">
              {assessment.founder_name || 'Opportunity Assessment'}
              {assessment.founder_company && <span className="text-gray-400 font-normal ml-2">({assessment.founder_company})</span>}
            </h1>
            <p className="text-sm text-gray-500 mt-0.5">
              {assessment.status === 'processing_inputs' && 'Processing uploaded materials...'}
              {assessment.status === 'running' && 'Agents analyzing...'}
              {assessment.status === 'synthesizing' && 'Synthesizing results...'}
              {assessment.status === 'complete' && `Completed ${new Date(assessment.updated_at).toLocaleDateString()}`}
              {assessment.status === 'partial' && 'Partial results (some agents failed)'}
              {assessment.status === 'error' && 'Assessment failed'}
              {assessment.status === 'cancelled' && 'Cancelled'}
            </p>
          </div>
          <div className="flex items-center gap-2">
            {assessment.overall_signal && (
              <span className={`text-lg font-bold ${SIGNAL_COLORS[assessment.overall_signal] || 'text-gray-400'}`}>
                {assessment.overall_signal}
              </span>
            )}
          </div>
        </div>

        {/* Action bar */}
        <div className="flex items-center gap-2 mb-6">
          {isRunning && (
            <button onClick={handleCancel} className="text-xs text-red-600 hover:text-red-700 border border-red-200 rounded-lg px-3 py-1.5 hover:bg-red-50 transition-colors">
              Cancel Run
            </button>
          )}
          {isComplete && (
            <button onClick={handleRerun} className="text-xs text-blue-600 hover:text-blue-700 border border-blue-200 rounded-lg px-3 py-1.5 hover:bg-blue-50 transition-colors">
              + Add Info & Re-run
            </button>
          )}
          {versions.length > 1 && (
            <button onClick={() => setShowVersions(!showVersions)} className="text-xs text-gray-500 hover:text-gray-700 border border-gray-200 rounded-lg px-3 py-1.5 hover:bg-gray-50 transition-colors">
              {showVersions ? 'Hide' : 'Show'} Version History ({versions.length})
            </button>
          )}
          <button onClick={handleDelete} className="text-xs text-gray-400 hover:text-red-500 border border-gray-200 rounded-lg px-3 py-1.5 hover:bg-red-50 transition-colors ml-auto">
            Delete
          </button>
        </div>

        {/* Per-agent progress (while running) */}
        {isRunning && (
          <div className="card p-4 mb-6">
            <div className="flex items-center gap-3 mb-3">
              <svg className="w-5 h-5 animate-spin text-blue-600" fill="none" viewBox="0 0 24 24">
                <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
              </svg>
              <span className="text-sm text-gray-600">
                {assessment.status === 'processing_inputs' ? 'Fetching URLs and processing files...' :
                 assessment.status === 'synthesizing' ? 'All agents complete. Synthesizing...' :
                 'Agents analyzing in parallel...'}
              </span>
            </div>
            <div className="grid grid-cols-5 gap-2">
              {AGENTS.map(agent => {
                const hasOutput = !!assessment[agent.field];
                return (
                  <div key={agent.key} className={`text-center rounded-lg py-2 ${hasOutput ? 'bg-emerald-50' : 'bg-gray-50'}`}>
                    {hasOutput ? (
                      <svg className="w-4 h-4 text-emerald-500 mx-auto" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M4.5 12.75l6 6 9-13.5" /></svg>
                    ) : (
                      <svg className="w-4 h-4 text-gray-300 mx-auto animate-pulse" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M12 6v6l4 2" /></svg>
                    )}
                    <p className={`text-[10px] mt-1 ${hasOutput ? 'text-emerald-600 font-medium' : 'text-gray-400'}`}>
                      {agent.label}{agent.key === 'bear' ? ' !' : ''}
                    </p>
                  </div>
                );
              })}
            </div>
          </div>
        )}

        {/* Version comparison (if showing) */}
        {showVersions && versions.length > 1 && (
          <div className="card p-4 mb-6">
            <h3 className="text-sm font-semibold text-gray-700 mb-3">Version History</h3>
            <div className="space-y-2">
              {versions.map((v) => {
                const vSynthesis = parseOutput(v.synthesis_output);
                const isCurrent = v.id === parseInt(id);
                return (
                  <Link key={v.id} to={`/assess/${v.id}`} className={`block rounded-lg p-3 transition-colors ${isCurrent ? 'bg-blue-50 border border-blue-200' : 'bg-gray-50 hover:bg-gray-100'}`}>
                    <div className="flex items-center justify-between">
                      <div>
                        <span className={`text-sm font-medium ${isCurrent ? 'text-blue-700' : 'text-gray-700'}`}>
                          Version {v.version_number || 1}
                        </span>
                        <span className="text-xs text-gray-400 ml-2">{new Date(v.created_at).toLocaleDateString()}</span>
                        {v.change_summary && <p className="text-xs text-gray-500 mt-0.5">{v.change_summary}</p>}
                      </div>
                      <div className="flex items-center gap-2">
                        {vSynthesis?.signal_scores && (
                          <div className="flex gap-1">
                            {Object.entries(vSynthesis.signal_scores).map(([k, val]) => (
                              <span key={k} className={`text-[10px] font-mono ${val >= 7 ? 'text-emerald-600' : val >= 5 ? 'text-amber-600' : 'text-red-500'}`}>{val}</span>
                            ))}
                          </div>
                        )}
                        <span className={`badge text-[10px] ${v.overall_signal === 'Strong Pass' ? 'badge-green' : v.overall_signal === 'Pass' ? 'badge-blue' : v.overall_signal === 'Watch' ? 'badge-amber' : v.overall_signal === 'Pass On' ? 'badge-red' : 'badge-gray'}`}>
                          {v.overall_signal || v.status}
                        </span>
                      </div>
                    </div>
                  </Link>
                );
              })}
            </div>
          </div>
        )}

        {/* Tabs */}
        <div className="flex gap-1 mb-6 bg-gray-100 rounded-lg p-1 overflow-x-auto">
          {TABS.map(tab => (
            <button
              key={tab.key}
              onClick={() => setActiveTab(tab.key)}
              className={`px-3 py-1.5 rounded-md text-sm font-medium transition-colors whitespace-nowrap ${
                activeTab === tab.key ? 'bg-white text-gray-900 shadow-sm' : 'text-gray-500 hover:text-gray-700'
              }`}
            >
              {tab.label}
              {tab.key === 'bear' && <span className="ml-1 text-red-500">!</span>}
            </button>
          ))}
        </div>

        {/* Tab content */}
        <div className="space-y-4">
          {activeTab === 'synthesis' && (
            synthesis ? (
              <div className="space-y-4">
                <div className="card p-4">
                  <h3 className="text-sm font-semibold text-gray-700 mb-2">Executive Summary</h3>
                  <p className="text-sm text-gray-600 whitespace-pre-wrap">{synthesis.executive_summary}</p>
                </div>

                {synthesis.signal_scores && (
                  <div className="card p-4">
                    <h3 className="text-sm font-semibold text-gray-700 mb-3">Signal Scorecard</h3>
                    <div className="grid grid-cols-5 gap-3">
                      {Object.entries(synthesis.signal_scores).map(([key, val]) => (
                        <div key={key} className="text-center">
                          <div className={`text-2xl font-bold ${val >= 7 ? 'text-emerald-600' : val >= 5 ? 'text-amber-600' : 'text-red-500'}`}>{val}</div>
                          <p className="text-[10px] text-gray-500 uppercase tracking-wider mt-1">{key.replace('_', ' ')}</p>
                        </div>
                      ))}
                    </div>
                  </div>
                )}

                {synthesis.top_questions && (
                  <div className="card p-4">
                    <h3 className="text-sm font-semibold text-gray-700 mb-2">Top Questions for Next Meeting</h3>
                    <ol className="text-sm text-gray-600 space-y-2">
                      {synthesis.top_questions.map((q, i) => (
                        <li key={i} className="flex gap-2"><span className="text-blue-600 font-bold">{i + 1}.</span> {q}</li>
                      ))}
                    </ol>
                  </div>
                )}

                {synthesis.recommended_next_step && (
                  <div className="card p-4">
                    <h3 className="text-sm font-semibold text-gray-700 mb-2">Recommended Next Step</h3>
                    <p className="text-sm text-blue-600 font-medium">{synthesis.recommended_next_step}</p>
                  </div>
                )}

                {synthesis.ic_memo_outline && (
                  <div className="card p-4">
                    <h3 className="text-sm font-semibold text-gray-700 mb-2">IC Memo Outline</h3>
                    {Object.entries(synthesis.ic_memo_outline).map(([key, val]) => (
                      <div key={key} className="mb-3">
                        <p className="text-xs text-gray-500 uppercase tracking-wider">{key.replace(/_/g, ' ')}</p>
                        <p className="text-sm text-gray-600 mt-0.5">{val}</p>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            ) : (
              <div className="text-center py-8 text-gray-500 text-sm">
                {isRunning ? 'Synthesis will appear once all agents complete...' : 'Synthesis not available'}
              </div>
            )
          )}

          {AGENTS.map(agent => (
            activeTab === agent.key && (
              <AgentOutput key={agent.key} data={parseOutput(assessment[agent.field])} type={agent.key} />
            )
          ))}

          {activeTab === 'inputs' && (
            <div className="space-y-3">
              {inputs.length === 0 ? (
                <div className="text-center py-8 text-gray-500 text-sm">No input materials recorded</div>
              ) : (
                inputs.map((inp, i) => (
                  <div key={i} className="card p-4">
                    <div className="flex items-center gap-2 mb-2">
                      <span className="badge badge-gray text-xs">{inp.input_type}</span>
                      <span className="text-sm font-medium text-gray-700">{inp.label || inp.input_type}</span>
                      {inp.source_url && <a href={inp.source_url} target="_blank" rel="noopener noreferrer" className="text-xs text-blue-500 hover:underline">{inp.source_url}</a>}
                    </div>
                    <p className="text-xs text-gray-500 max-h-32 overflow-y-auto whitespace-pre-wrap">{(inp.content || '').slice(0, 2000)}{(inp.content || '').length > 2000 ? '...' : ''}</p>
                  </div>
                ))
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function AgentOutput({ data, type }) {
  if (!data) return <div className="text-center py-8 text-gray-500 text-sm">Agent output not yet available</div>;
  if (data.error) return <div className="card p-4 text-sm text-red-600">Agent error: {data.error}</div>;

  // ── New Founder Assessment Layout ──
  if (type === 'founder' && data.verdict) {
    return <FounderAssessment data={data} />;
  }

  // ── Legacy founder format (backward compat) ──
  if (type === 'founder' && data.trait_scores && !data.verdict) {
    return <LegacyFounderOutput data={data} />;
  }

  return (
    <div className="space-y-4">
      {data.narrative && (
        <div className="card p-4">
          <h3 className="text-sm font-semibold text-gray-700 mb-2">Analysis</h3>
          <p className="text-sm text-gray-600 whitespace-pre-wrap">{data.narrative}</p>
        </div>
      )}

      {/* Market-specific */}
      {type === 'market' && data.enabling_conditions && (
        <div className="card p-4">
          <h3 className="text-sm font-semibold text-gray-700 mb-3">Enabling Conditions</h3>
          <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
            {Object.entries(data.enabling_conditions).filter(([k]) => k !== 'convergence_score').map(([key, val]) => (
              <div key={key} className="bg-gray-50 rounded-lg p-3">
                <p className="text-[10px] text-gray-500 uppercase tracking-wider">{key.replace(/_/g, ' ')}</p>
                <p className={`text-lg font-bold ${(val.score || val) >= 7 ? 'text-emerald-600' : (val.score || val) >= 5 ? 'text-amber-600' : 'text-red-500'}`}>{val.score || val}/10</p>
                {val.evidence && <p className="text-xs text-gray-500 mt-1">{val.evidence}</p>}
              </div>
            ))}
          </div>
          {data.enabling_conditions.convergence_score && (
            <div className="mt-3 pt-3 border-t border-gray-100 flex items-center justify-between">
              <span className="text-sm text-gray-500">Convergence Score</span>
              <span className="text-lg font-bold text-blue-600">{data.enabling_conditions.convergence_score}/10</span>
            </div>
          )}
        </div>
      )}

      {type === 'market' && data.why_now_score && (
        <div className="card p-4">
          <h3 className="text-sm font-semibold text-gray-700 mb-3">Why Now</h3>
          <div className="grid grid-cols-3 gap-3">
            {Object.entries(data.why_now_score).map(([key, val]) => (
              <div key={key} className="bg-gray-50 rounded-lg p-3 text-center">
                <p className={`text-lg font-bold ${(val.score || val) >= 7 ? 'text-emerald-600' : (val.score || val) >= 5 ? 'text-amber-600' : 'text-red-500'}`}>{val.score || val}/10</p>
                <p className="text-[10px] text-gray-500 uppercase tracking-wider capitalize">{key}</p>
              </div>
            ))}
          </div>
        </div>
      )}

      {type === 'market' && (data.tam_assessment || data.market_timing) && (
        <div className="card p-4 flex items-center gap-6 flex-wrap">
          {data.tam_assessment && <div><p className="text-xs text-gray-500 uppercase">TAM</p><p className="text-sm font-medium text-gray-900 mt-0.5 capitalize">{data.tam_assessment}</p></div>}
          {data.market_timing && <div><p className="text-xs text-gray-500 uppercase">Timing</p><p className="text-sm font-medium text-gray-900 mt-0.5 capitalize">{data.market_timing}</p></div>}
        </div>
      )}

      {/* Economics-specific */}
      {type === 'economics' && data.metrics_disclosed && (
        <div className="card p-4">
          <h3 className="text-sm font-semibold text-gray-700 mb-3">Metrics Disclosed</h3>
          <div className="grid grid-cols-2 gap-2">
            {Object.entries(data.metrics_disclosed).filter(([_, v]) => v && v !== 'null' && v !== 'N/A').map(([key, val]) => (
              <div key={key} className="bg-gray-50 rounded-lg p-2">
                <p className="text-[10px] text-gray-500 uppercase">{key.replace(/_/g, ' ')}</p>
                <p className="text-sm text-gray-700">{val}</p>
              </div>
            ))}
          </div>
        </div>
      )}

      {type === 'economics' && data.implied_unit_economics && (
        <div className="card p-4">
          <h3 className="text-sm font-semibold text-gray-700 mb-3">Implied Unit Economics</h3>
          {Object.entries(data.implied_unit_economics).map(([key, val]) => (
            <div key={key} className="mb-2">
              <p className="text-xs text-gray-500 uppercase">{key.replace(/_/g, ' ')}</p>
              <p className="text-sm text-gray-600">{val}</p>
            </div>
          ))}
        </div>
      )}

      {type === 'economics' && (data.revenue_quality_signal || data.nrr_potential) && (
        <div className="card p-4 flex items-center gap-6 flex-wrap">
          {data.revenue_quality_signal && <div><p className="text-xs text-gray-500 uppercase">Revenue Quality</p><p className="text-sm font-medium capitalize">{data.revenue_quality_signal}</p></div>}
          {data.nrr_potential && <div><p className="text-xs text-gray-500 uppercase">NRR Potential</p><p className="text-sm font-medium capitalize">{data.nrr_potential.replace(/_/g, ' ')}</p></div>}
        </div>
      )}

      {/* Bear-specific */}
      {type === 'bear' && data.primary_risks && (
        <div className="card p-4">
          <h3 className="text-sm font-semibold text-red-600 mb-3">Primary Risks</h3>
          <div className="space-y-3">
            {data.primary_risks.map((r, i) => (
              <div key={i} className="bg-gray-50 rounded-lg p-3">
                <div className="flex items-center gap-2 mb-1">
                  <span className={`badge ${r.severity === 'high' ? 'badge-red' : r.severity === 'medium' ? 'badge-amber' : 'badge-gray'}`}>{r.severity}</span>
                  <span className="text-sm font-medium text-gray-800">{r.risk}</span>
                </div>
                {r.detail && <p className="text-xs text-gray-500 mt-1">{r.detail}</p>}
                {r.mitigation && <p className="text-xs text-gray-400 mt-1">Mitigation: {r.mitigation}</p>}
              </div>
            ))}
          </div>
        </div>
      )}

      {type === 'bear' && data.kill_shot_risk && (
        <div className="card p-4 border-red-200">
          <h3 className="text-sm font-semibold text-red-600 mb-2">Kill Shot Risk</h3>
          <p className="text-sm text-gray-600">{data.kill_shot_risk}</p>
        </div>
      )}

      {type === 'bear' && data.failure_scenarios && (
        <div className="card p-4">
          <h3 className="text-sm font-semibold text-gray-700 mb-2">Failure Scenarios</h3>
          <ul className="text-sm text-gray-600 space-y-1.5">
            {data.failure_scenarios.map((s, i) => <li key={i} className="flex gap-2"><span className="text-red-400">-</span> {s}</li>)}
          </ul>
        </div>
      )}

      {/* Pattern-specific */}
      {type === 'pattern' && data.pattern_matches && (
        <div className="card p-4">
          <h3 className="text-sm font-semibold text-gray-700 mb-3">Pattern Matches</h3>
          {data.pattern_matches.map((p, i) => (
            <div key={i} className="flex items-start gap-2 mb-2">
              <span className={`badge ${p.verdict === 'strong_match' ? 'badge-green' : p.verdict === 'partial_match' ? 'badge-amber' : 'badge-red'}`}>
                {p.verdict?.replace(/_/g, ' ')}
              </span>
              <div>
                <p className="text-sm text-gray-700">{p.pattern}</p>
                {p.evidence && <p className="text-xs text-gray-500 mt-0.5">{p.evidence}</p>}
              </div>
            </div>
          ))}
        </div>
      )}

      {type === 'pattern' && data.pattern_breaks && data.pattern_breaks.length > 0 && (
        <div className="card p-4">
          <h3 className="text-sm font-semibold text-amber-600 mb-3">Pattern Breaks</h3>
          {data.pattern_breaks.map((p, i) => (
            <div key={i} className="flex items-start gap-2 mb-2">
              <span className={`badge ${p.verdict === 'intentional_anti_pattern' ? 'badge-blue' : 'badge-red'}`}>
                {p.verdict?.replace(/_/g, ' ')}
              </span>
              <div>
                <p className="text-sm text-gray-700">{p.pattern}</p>
                {p.interpretation && <p className="text-xs text-gray-500 mt-0.5">{p.interpretation}</p>}
              </div>
            </div>
          ))}
        </div>
      )}

      {type === 'pattern' && (data.portfolio_fit || data.comparable_deals) && (
        <div className="card p-4">
          {data.portfolio_fit && <div className="mb-3"><p className="text-xs text-gray-500 uppercase">Portfolio Fit</p><p className="text-sm text-gray-700 capitalize">{data.portfolio_fit}</p></div>}
          {data.comparable_deals && data.comparable_deals.length > 0 && (
            <div><p className="text-xs text-gray-500 uppercase mb-1">Comparable Deals</p>{data.comparable_deals.map((d, i) => <p key={i} className="text-sm text-gray-600">- {d}</p>)}</div>
          )}
        </div>
      )}

      {/* Key questions (all agents) */}
      {data.key_questions && (
        <div className="card p-4">
          <h3 className="text-sm font-semibold text-gray-700 mb-2">Key Questions</h3>
          <ul className="text-sm text-gray-600 space-y-1.5">
            {data.key_questions.map((q, i) => (
              <li key={i} className="flex gap-2"><span className="text-blue-600">?</span> {q}</li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}

// ════════════════════════════════════════════════════════
// New Founder Assessment Component
// ════════════════════════════════════════════════════════

const SIGNAL_BG = {
  'Strong Pass': 'bg-emerald-50 border-emerald-200',
  'Pass': 'bg-blue-50 border-blue-200',
  'Watch': 'bg-amber-50 border-amber-200',
  'Pass On': 'bg-red-50 border-red-200',
};
const SIGNAL_TEXT = {
  'Strong Pass': 'text-emerald-700',
  'Pass': 'text-blue-700',
  'Watch': 'text-amber-700',
  'Pass On': 'text-red-700',
};
const FIT_COLORS = {
  'strong': 'text-emerald-600 bg-emerald-50',
  'moderate': 'text-amber-600 bg-amber-50',
  'weak': 'text-red-600 bg-red-50',
};
const QUOTE_COLORS = {
  'POSITIVE': 'border-l-emerald-400',
  'NEGATIVE': 'border-l-red-400',
  'MIXED': 'border-l-amber-400',
};

function scoreColor(score) {
  if (score >= 7) return 'text-emerald-600';
  if (score >= 5) return 'text-amber-600';
  return 'text-red-500';
}

function scoreBg(score) {
  if (score >= 7) return 'bg-emerald-500';
  if (score >= 5) return 'bg-amber-500';
  return 'bg-red-500';
}

function FounderAssessment({ data }) {
  const v = data.verdict;
  const traits = data.four_traits;

  return (
    <div className="space-y-4">
      {/* ── VERDICT BANNER ── */}
      <div className={`rounded-xl border p-5 ${SIGNAL_BG[v.signal] || 'bg-gray-50 border-gray-200'}`}>
        <div className="flex items-start justify-between gap-4">
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-3 mb-2">
              <span className={`text-2xl font-black ${SIGNAL_TEXT[v.signal] || 'text-gray-700'}`}>{v.signal}</span>
              <span className={`text-3xl font-black ${scoreColor(v.score)}`}>{v.score}<span className="text-base font-medium text-gray-400">/10</span></span>
            </div>
            <p className="text-sm text-gray-800 font-medium leading-snug">{v.one_liner}</p>
          </div>
          <div className="text-right shrink-0">
            <p className="text-[10px] text-gray-400 uppercase tracking-wider">Archetype</p>
            <p className="text-xs font-mono text-gray-600 mt-0.5">{v.archetype}</p>
            {data.stage_classification && (
              <>
                <p className="text-[10px] text-gray-400 uppercase tracking-wider mt-2">Stage</p>
                <p className="text-xs font-medium text-gray-600 mt-0.5">{data.stage_classification}</p>
              </>
            )}
          </div>
        </div>
      </div>

      {/* ── SNAPSHOT ── */}
      {data.snapshot && data.snapshot.length > 0 && (
        <div className="card p-4">
          <h3 className="text-xs font-semibold text-gray-400 uppercase tracking-wider mb-2">Snapshot</h3>
          <ul className="space-y-1.5">
            {data.snapshot.map((bullet, i) => (
              <li key={i} className="text-sm text-gray-700 flex gap-2">
                <span className="text-gray-300 shrink-0">-</span>
                <span>{bullet}</span>
              </li>
            ))}
          </ul>
        </div>
      )}

      {/* ── THE READ ── */}
      {data.the_read && (
        <div className="card p-4 border-l-4 border-l-gray-900">
          <h3 className="text-xs font-semibold text-gray-400 uppercase tracking-wider mb-2">The Read</h3>
          <p className="text-sm text-gray-700 leading-relaxed">{data.the_read}</p>
        </div>
      )}

      {/* ── FOUNDER-PROBLEM FIT + FOUNDER-MARKET FIT ── */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        {data.founder_problem_fit && (
          <div className="card p-4">
            <div className="flex items-center justify-between mb-2">
              <h3 className="text-xs font-semibold text-gray-400 uppercase tracking-wider">Founder-Problem Fit</h3>
              <div className="flex items-center gap-2">
                <span className={`text-[10px] font-medium px-2 py-0.5 rounded-full ${FIT_COLORS[data.founder_problem_fit.fit_signal] || 'text-gray-500 bg-gray-50'}`}>
                  {data.founder_problem_fit.fit_signal}
                </span>
                <span className="text-[10px] text-gray-400 font-mono">
                  {data.founder_problem_fit.insight_type === 'earned_insider' ? 'EARNED' : 'SYNTHESIZED'}
                </span>
              </div>
            </div>
            <p className="text-sm text-gray-600 leading-relaxed">{data.founder_problem_fit.assessment}</p>
          </div>
        )}

        {data.founder_market_fit && (
          <div className="card p-4">
            <div className="flex items-center justify-between mb-2">
              <h3 className="text-xs font-semibold text-gray-400 uppercase tracking-wider">Founder-Market Fit</h3>
              <span className={`text-[10px] font-medium px-2 py-0.5 rounded-full ${FIT_COLORS[data.founder_market_fit.fit_signal] || 'text-gray-500 bg-gray-50'}`}>
                {data.founder_market_fit.fit_signal}
              </span>
            </div>
            <p className="text-sm text-gray-600 leading-relaxed">{data.founder_market_fit.assessment}</p>
          </div>
        )}
      </div>

      {/* ── FOUR TRAITS ── */}
      {traits && (
        <div className="card p-4">
          <h3 className="text-xs font-semibold text-gray-400 uppercase tracking-wider mb-4">Four Required Traits</h3>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {[
              { key: 'speed', label: 'Speed' },
              { key: 'storytelling', label: 'Storytelling' },
              { key: 'salesmanship', label: 'Salesmanship' },
              { key: 'build_and_motivate', label: 'Build + Motivate' },
            ].map(({ key, label }) => {
              const trait = traits[key];
              if (!trait) return null;
              return (
                <div key={key} className="bg-gray-50 rounded-lg p-3">
                  <div className="flex items-center justify-between mb-2">
                    <span className="text-sm font-semibold text-gray-700">{label}</span>
                    <span className={`text-lg font-black ${scoreColor(trait.score)}`}>{trait.score}</span>
                  </div>
                  <div className="w-full bg-gray-200 rounded-full h-1 mb-2">
                    <div className={`h-1 rounded-full ${scoreBg(trait.score)}`} style={{ width: `${trait.score * 10}%` }} />
                  </div>
                  <p className="text-xs text-gray-500 leading-relaxed">{trait.evidence}</p>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* ── KEY QUOTES ── */}
      {data.key_quotes && data.key_quotes.length > 0 && (
        <div className="card p-4">
          <h3 className="text-xs font-semibold text-gray-400 uppercase tracking-wider mb-3">Key Quotes</h3>
          <div className="space-y-3">
            {data.key_quotes.map((q, i) => (
              <div key={i} className={`border-l-3 pl-3 ${QUOTE_COLORS[q.signal] || 'border-l-gray-300'}`}>
                <p className="text-sm text-gray-800 italic">"{q.quote}"</p>
                <p className="text-xs text-gray-500 mt-1">
                  <span className={`font-medium ${q.signal === 'POSITIVE' ? 'text-emerald-600' : q.signal === 'NEGATIVE' ? 'text-red-600' : 'text-amber-600'}`}>
                    {q.signal}
                  </span>
                  {' — '}{q.read}
                </p>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* ── RISKS ── */}
      {data.risks && data.risks.length > 0 && (
        <div className="card p-4">
          <h3 className="text-xs font-semibold text-gray-400 uppercase tracking-wider mb-3">Risks</h3>
          <div className="space-y-2">
            {data.risks.map((r, i) => (
              <div key={i} className="flex items-start gap-2">
                <span className={`text-[10px] font-bold uppercase px-1.5 py-0.5 rounded shrink-0 mt-0.5 ${
                  r.severity === 'high' ? 'bg-red-100 text-red-700' :
                  r.severity === 'medium' ? 'bg-amber-100 text-amber-700' :
                  'bg-gray-100 text-gray-600'
                }`}>{r.severity}</span>
                <div>
                  <p className="text-sm text-gray-800">{r.risk}</p>
                  {r.evidence && <p className="text-xs text-gray-400 mt-0.5">{r.evidence}</p>}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* ── OPEN QUESTIONS ── */}
      {data.open_questions && data.open_questions.length > 0 && (
        <div className="card p-4">
          <h3 className="text-xs font-semibold text-gray-400 uppercase tracking-wider mb-2">Open Questions for Next Meeting</h3>
          <ul className="space-y-1.5">
            {data.open_questions.map((q, i) => (
              <li key={i} className="text-sm text-gray-600 flex gap-2">
                <span className="text-blue-500 font-bold shrink-0">{i + 1}.</span>
                <span>{q}</span>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}

// ════════════════════════════════════════════════════════
// Legacy Founder Output (backward compat for old assessments)
// ════════════════════════════════════════════════════════

function LegacyFounderOutput({ data }) {
  return (
    <div className="space-y-4">
      {data.narrative && (
        <div className="card p-4">
          <h3 className="text-sm font-semibold text-gray-700 mb-2">Analysis</h3>
          <p className="text-sm text-gray-600 whitespace-pre-wrap">{data.narrative}</p>
        </div>
      )}
      {data.trait_scores && (
        <div className="card p-4">
          <h3 className="text-sm font-semibold text-gray-700 mb-3">Required Traits</h3>
          <div className="space-y-3">
            {Object.entries(data.trait_scores).map(([trait, val]) => (
              <div key={trait}>
                <div className="flex items-center justify-between mb-1">
                  <span className="text-sm text-gray-600 capitalize">{trait === 'build' ? 'Build + Motivate' : trait}</span>
                  <span className={`text-sm font-bold ${val.score >= 7 ? 'text-emerald-600' : val.score >= 5 ? 'text-amber-600' : 'text-red-500'}`}>{val.score}/10</span>
                </div>
                <div className="w-full bg-gray-100 rounded-full h-1.5">
                  <div className={`h-1.5 rounded-full ${val.score >= 7 ? 'bg-emerald-500' : val.score >= 5 ? 'bg-amber-500' : 'bg-red-500'}`} style={{ width: `${val.score * 10}%` }} />
                </div>
                {val.evidence && <p className="text-xs text-gray-500 mt-1">{val.evidence}</p>}
                {val.gaps && <p className="text-xs text-amber-600 mt-0.5">Gap: {val.gaps}</p>}
              </div>
            ))}
          </div>
        </div>
      )}
      {data.eniac_dimensions && (
        <div className="card p-4">
          <h3 className="text-sm font-semibold text-gray-700 mb-3">ENIAC Dimensions</h3>
          <div className="grid grid-cols-3 gap-2">
            {Object.entries(data.eniac_dimensions).map(([key, val]) => (
              <div key={key} className="bg-gray-50 rounded-lg p-2 text-center">
                <p className={`text-lg font-bold ${val >= 7 ? 'text-emerald-600' : val >= 5 ? 'text-amber-600' : 'text-red-500'}`}>{val}</p>
                <p className="text-[10px] text-gray-500 capitalize">{key.replace(/_/g, ' ')}</p>
              </div>
            ))}
          </div>
        </div>
      )}
      {(data.stage_classification || data.founding_insight_type) && (
        <div className="card p-4 flex items-center gap-6 flex-wrap">
          {data.stage_classification && (
            <div>
              <p className="text-xs text-gray-500 uppercase tracking-wider">Stage</p>
              <p className="text-sm font-medium text-gray-900 mt-0.5">{data.stage_classification}</p>
            </div>
          )}
          {data.founding_insight_type && (
            <div>
              <p className="text-xs text-gray-500 uppercase tracking-wider">Insight Type</p>
              <p className="text-sm font-medium text-gray-900 mt-0.5">{data.founding_insight_type.replace(/_/g, ' ')}</p>
            </div>
          )}
          {data.overall_signal && (
            <div>
              <p className="text-xs text-gray-500 uppercase tracking-wider">Signal</p>
              <p className={`text-sm font-medium mt-0.5 ${data.overall_signal === 'Strong Pass' ? 'text-emerald-600' : data.overall_signal === 'Pass' ? 'text-blue-600' : data.overall_signal === 'Watch' ? 'text-amber-600' : 'text-red-500'}`}>{data.overall_signal}</p>
            </div>
          )}
        </div>
      )}
      {data.key_questions && (
        <div className="card p-4">
          <h3 className="text-sm font-semibold text-gray-700 mb-2">Key Questions</h3>
          <ul className="text-sm text-gray-600 space-y-1.5">
            {data.key_questions.map((q, i) => (
              <li key={i} className="flex gap-2"><span className="text-blue-600">?</span> {q}</li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
