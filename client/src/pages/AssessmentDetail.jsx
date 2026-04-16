import { useState, useEffect, useRef } from 'react';
import { useParams, Link, useNavigate } from 'react-router-dom';
import { api } from '../utils/api';

// Agent tab config — maps to DB columns (reused existing column names)
const AGENTS = [
  { key: 'team', label: 'Team', field: 'founder_agent_output' },
  { key: 'product', label: 'Product', field: 'market_agent_output' },
  { key: 'market', label: 'Market', field: 'economics_agent_output' },
  { key: 'bear', label: 'Bear', field: 'bear_agent_output' },
];

const TABS = [
  { key: 'synthesis', label: 'Synthesis' },
  ...AGENTS.map(a => ({ key: a.key, label: a.label })),
  { key: 'rubric', label: 'Rubric' },
  { key: 'inputs', label: 'Materials' },
];

const RUBRIC_TRAITS = [
  { key: 'fluent_ecosystem_mapping', label: 'Fluent ecosystem mapping' },
  { key: 'strategic_spine', label: 'Strategic spine' },
  { key: 'confident_humble_register', label: 'Confident-humble register' },
  { key: 'distribution_first_sequencing', label: 'Distribution-first sequencing' },
  { key: 'customer_sourced_thesis', label: 'Customer-sourced thesis' },
  { key: 'status_cost_inversion', label: 'Status-cost inversion' },
  { key: 'honest_under_pressure', label: 'Honest under pressure' },
  { key: 'buy_vs_build_discipline', label: 'Buy-vs-build discipline' },
  { key: 'cap_table_sophistication', label: 'Cap-table sophistication' },
];

const THRESHOLD_STYLES = {
  'Anchor-grade': { bg: 'bg-purple-50 border-purple-200', text: 'text-purple-700', badge: 'bg-purple-100 text-purple-700' },
  'Top-quartile': { bg: 'bg-emerald-50 border-emerald-200', text: 'text-emerald-700', badge: 'bg-emerald-100 text-emerald-700' },
  'Monitor': { bg: 'bg-amber-50 border-amber-200', text: 'text-amber-700', badge: 'bg-amber-100 text-amber-700' },
  'Pass with respect': { bg: 'bg-gray-50 border-gray-200', text: 'text-gray-700', badge: 'bg-gray-100 text-gray-700' },
  'Pass': { bg: 'bg-red-50 border-red-200', text: 'text-red-700', badge: 'bg-red-100 text-red-700' },
};

export default function AssessmentDetail() {
  const { id } = useParams();
  const navigate = useNavigate();
  const [assessment, setAssessment] = useState(null);
  const [loading, setLoading] = useState(true);
  const [activeTab, setActiveTab] = useState('synthesis');
  const [versions, setVersions] = useState([]);
  const [inputs, setInputs] = useState([]);
  const [showVersions, setShowVersions] = useState(false);
  const [rubric, setRubric] = useState(null);
  const [rubricLoading, setRubricLoading] = useState(false);
  const pollRef = useRef(null);
  const rubricPollRef = useRef(null);

  useEffect(() => {
    loadAssessment();
    loadRubric();
    return () => {
      if (pollRef.current) clearInterval(pollRef.current);
      if (rubricPollRef.current) clearInterval(rubricPollRef.current);
    };
  }, [id]);

  async function loadRubric() {
    try {
      const r = await api.getStewardOperator(id);
      setRubric(r);
      if (r && r.status === 'running') {
        startRubricPoll();
      }
    } catch {}
  }

  function startRubricPoll() {
    if (rubricPollRef.current) return;
    rubricPollRef.current = setInterval(async () => {
      try {
        const r = await api.getStewardOperator(id);
        setRubric(r);
        if (!r || r.status !== 'running') {
          clearInterval(rubricPollRef.current);
          rubricPollRef.current = null;
        }
      } catch {}
    }, 3000);
  }

  async function handleRunRubric() {
    setRubricLoading(true);
    try {
      const r = await api.runStewardOperator(id);
      setRubric(r);
      startRubricPoll();
    } catch (err) {
      console.error('Failed to start rubric:', err);
    } finally {
      setRubricLoading(false);
    }
  }

  async function loadAssessment() {
    try {
      const a = await api.getAssessment(id);
      setAssessment(a);

      api.getAssessmentInputs(id).then(setInputs).catch(() => {});

      if (a.group_id) {
        api.getAssessmentGroup(a.group_id).then(setVersions).catch(() => {});
      }

      if (a.status === 'running' || a.status === 'synthesizing' || a.status === 'processing_inputs') {
        pollRef.current = setInterval(async () => {
          try {
            const updated = await api.getAssessment(id);
            setAssessment(updated);
            if (updated.status === 'complete' || updated.status === 'partial' || updated.status === 'error') {
              clearInterval(pollRef.current);
              pollRef.current = null;
            }
          } catch {}
        }, 3000);
      }
    } catch (err) {
      console.error('Failed to load assessment:', err);
    } finally {
      setLoading(false);
    }
  }

  function parseOutput(raw) {
    if (!raw) return null;
    try { return typeof raw === 'string' ? JSON.parse(raw) : raw; }
    catch { return null; }
  }

  if (loading) return <div className="text-center py-12 text-gray-500 text-sm">Loading...</div>;
  if (!assessment) return <div className="text-center py-12 text-gray-500 text-sm">Assessment not found</div>;

  const synthesis = parseOutput(assessment.synthesis_output);
  const isRunning = ['running', 'synthesizing', 'processing_inputs'].includes(assessment.status);
  const isComplete = assessment.status === 'complete' || assessment.status === 'partial';

  const SIGNAL_COLORS = {
    'Invest': 'text-emerald-600',
    'Monitor': 'text-amber-600',
    'Pass': 'text-red-600',
  };

  return (
    <div className="flex gap-6">
      {/* Main content */}
      <div className="flex-1 min-w-0">
        {/* Breadcrumb */}
        <div className="flex items-center gap-2 text-sm text-gray-400 mb-4">
          <Link to="/assess" className="hover:text-gray-600">Assess</Link>
          <span>/</span>
          <span className="text-gray-700">{assessment.founder_name || 'Assessment'}</span>
          {assessment.founder_company && <span className="text-gray-400">/ {assessment.founder_company}</span>}
        </div>

        {/* Header */}
        <div className="flex items-start justify-between mb-6">
          <div>
            <h1 className="text-xl font-bold text-gray-900">{assessment.founder_name || 'Unknown Founder'}</h1>
            <p className="text-sm text-gray-500 mt-0.5">{assessment.founder_company || ''}</p>
          </div>
          <div className="flex items-center gap-3">
            <span className={`text-lg font-bold ${SIGNAL_COLORS[assessment.overall_signal] || 'text-gray-500'}`}>
              {assessment.overall_signal || assessment.status}
            </span>
            {isRunning && (
              <span className="badge badge-blue animate-pulse text-xs">
                {assessment.status === 'processing_inputs' ? 'Processing...' : assessment.status === 'synthesizing' ? 'Synthesizing...' : 'Running...'}
              </span>
            )}
          </div>
        </div>

        {/* Version history */}
        {versions.length > 1 && (
          <div className="mb-4">
            <button onClick={() => setShowVersions(!showVersions)} className="text-xs text-gray-400 hover:text-gray-600">
              {showVersions ? 'Hide' : 'Show'} version history ({versions.length} versions)
            </button>
            {showVersions && (
              <div className="mt-2 space-y-1">
                {versions.map(v => {
                  const vSynthesis = parseOutput(v.synthesis_output);
                  return (
                    <Link key={v.id} to={`/assess/${v.id}`}
                      className={`block rounded-lg p-2 text-sm ${v.id === parseInt(id) ? 'bg-blue-50 border border-blue-200' : 'bg-gray-50 hover:bg-gray-100'}`}>
                      <div className="flex items-center justify-between">
                        <div>
                          <span className="font-medium">v{v.version_number}</span>
                          <span className="text-gray-400 ml-2">{new Date(v.created_at).toLocaleDateString()}</span>
                          {v.change_summary && <span className="text-gray-400 ml-2">{v.change_summary}</span>}
                        </div>
                        <div className="flex items-center gap-2">
                          {vSynthesis?.pillar_scores && (
                            <div className="flex gap-1 text-[10px] font-mono">
                              <span className={vSynthesis.pillar_scores.team >= 7 ? 'text-emerald-600' : vSynthesis.pillar_scores.team >= 5 ? 'text-amber-600' : 'text-red-500'}>T:{vSynthesis.pillar_scores.team}</span>
                              <span className={vSynthesis.pillar_scores.product >= 7 ? 'text-emerald-600' : vSynthesis.pillar_scores.product >= 5 ? 'text-amber-600' : 'text-red-500'}>P:{vSynthesis.pillar_scores.product}</span>
                              <span className={vSynthesis.pillar_scores.market >= 7 ? 'text-emerald-600' : vSynthesis.pillar_scores.market >= 5 ? 'text-amber-600' : 'text-red-500'}>M:{vSynthesis.pillar_scores.market}</span>
                            </div>
                          )}
                          <span className={`badge text-[10px] ${v.overall_signal === 'Invest' ? 'badge-green' : v.overall_signal === 'Monitor' ? 'badge-amber' : v.overall_signal === 'Pass' ? 'badge-red' : 'badge-gray'}`}>
                            {v.overall_signal || v.status}
                          </span>
                        </div>
                      </div>
                    </Link>
                  );
                })}
              </div>
            )}
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
              {tab.key === 'rubric' && rubric && rubric.flagged ? <span className="ml-1 text-purple-600">*</span> : null}
            </button>
          ))}
        </div>

        {/* Tab content */}
        <div className="space-y-4">
          {activeTab === 'synthesis' && (
            synthesis ? <SynthesisView data={synthesis} /> : (
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

          {activeTab === 'rubric' && (
            <RubricView
              rubric={rubric}
              assessmentComplete={isComplete}
              onRun={handleRunRubric}
              running={rubricLoading || (rubric && rubric.status === 'running')}
            />
          )}

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

// ════════════════════════════════════════════════════════
// Shared helpers
// ════════════════════════════════════════════════════════

const SIGNAL_BG = {
  'Invest': 'bg-emerald-50 border-emerald-200',
  'Monitor': 'bg-amber-50 border-amber-200',
  'Pass': 'bg-red-50 border-red-200',
};
const SIGNAL_TEXT = {
  'Invest': 'text-emerald-700',
  'Monitor': 'text-amber-700',
  'Pass': 'text-red-700',
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

function SubcategoryCard({ label, score, evidence, extras }) {
  return (
    <div className="bg-gray-50 rounded-lg p-3">
      <div className="flex items-center justify-between mb-2">
        <span className="text-sm font-semibold text-gray-700">{label}</span>
        <span className={`text-lg font-black ${scoreColor(score)}`}>{score}</span>
      </div>
      <div className="w-full bg-gray-200 rounded-full h-1 mb-2">
        <div className={`h-1 rounded-full ${scoreBg(score)}`} style={{ width: `${score * 10}%` }} />
      </div>
      <p className="text-xs text-gray-500 leading-relaxed">{evidence}</p>
      {extras}
    </div>
  );
}

function RisksList({ risks }) {
  if (!risks || risks.length === 0) return null;
  return (
    <div className="card p-4">
      <h3 className="text-xs font-semibold text-gray-400 uppercase tracking-wider mb-3">Risks</h3>
      <div className="space-y-2">
        {risks.map((r, i) => (
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
  );
}

function QuestionsList({ questions, title }) {
  if (!questions || questions.length === 0) return null;
  return (
    <div className="card p-4">
      <h3 className="text-xs font-semibold text-gray-400 uppercase tracking-wider mb-2">{title || 'Open Questions'}</h3>
      <ul className="space-y-1.5">
        {questions.map((q, i) => (
          <li key={i} className="text-sm text-gray-600 flex gap-2">
            <span className="text-blue-500 font-bold shrink-0">{i + 1}.</span>
            <span>{q}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}

// ════════════════════════════════════════════════════════
// Synthesis View
// ════════════════════════════════════════════════════════

function SynthesisView({ data }) {
  return (
    <div className="space-y-4">
      {/* Verdict banner */}
      {data.overall_signal && (
        <div className={`rounded-xl border p-5 ${SIGNAL_BG[data.overall_signal] || 'bg-gray-50 border-gray-200'}`}>
          <div className="flex items-start justify-between gap-4">
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-3 mb-2">
                <span className={`text-2xl font-black ${SIGNAL_TEXT[data.overall_signal] || 'text-gray-700'}`}>{data.overall_signal}</span>
                {data.overall_score && (
                  <span className={`text-3xl font-black ${scoreColor(data.overall_score)}`}>
                    {data.overall_score}<span className="text-base font-medium text-gray-400">/10</span>
                  </span>
                )}
              </div>
              {data.one_liner && <p className="text-sm text-gray-800 font-medium leading-snug">{data.one_liner}</p>}
            </div>
            {data.recommended_next_step && (
              <div className="text-right shrink-0">
                <p className="text-[10px] text-gray-400 uppercase tracking-wider">Next Step</p>
                <p className="text-sm font-semibold text-blue-600 mt-0.5">{data.recommended_next_step}</p>
              </div>
            )}
          </div>
        </div>
      )}

      {/* Pillar scores */}
      {data.pillar_scores && (
        <div className="card p-4">
          <h3 className="text-xs font-semibold text-gray-400 uppercase tracking-wider mb-3">Pillar Scores</h3>
          <div className="grid grid-cols-3 gap-4">
            {[
              { key: 'team', label: 'Team', weight: '45%' },
              { key: 'product', label: 'Product', weight: '25%' },
              { key: 'market', label: 'Market', weight: '30%' },
            ].map(({ key, label, weight }) => {
              const val = data.pillar_scores[key];
              if (val == null) return null;
              return (
                <div key={key} className="text-center">
                  <div className={`text-3xl font-black ${scoreColor(val)}`}>{val}</div>
                  <p className="text-sm font-semibold text-gray-700 mt-1">{label}</p>
                  <p className="text-[10px] text-gray-400">{weight} weight</p>
                </div>
              );
            })}
          </div>
          {data.bear_adjustment != null && data.bear_adjustment !== 0 && (
            <div className="mt-3 pt-3 border-t border-gray-100 flex items-center justify-between">
              <span className="text-xs text-gray-500">Bear Adjustment</span>
              <span className="text-sm font-bold text-red-600">{data.bear_adjustment}</span>
            </div>
          )}
          {data.score_calculation && (
            <div className="mt-2 pt-2 border-t border-gray-100">
              <p className="text-[10px] text-gray-400 font-mono">{data.score_calculation}</p>
            </div>
          )}
        </div>
      )}

      {/* Executive Summary */}
      {data.executive_summary && (
        <div className="card p-4">
          <h3 className="text-xs font-semibold text-gray-400 uppercase tracking-wider mb-2">Executive Summary</h3>
          <p className="text-sm text-gray-600 whitespace-pre-wrap leading-relaxed">{data.executive_summary}</p>
        </div>
      )}

      {/* Consensus & Disagreements */}
      {(data.agent_consensus || data.agent_disagreements) && (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {data.agent_consensus && data.agent_consensus.length > 0 && (
            <div className="card p-4">
              <h3 className="text-xs font-semibold text-emerald-600 uppercase tracking-wider mb-2">Agent Consensus</h3>
              <ul className="space-y-1.5">
                {data.agent_consensus.map((c, i) => (
                  <li key={i} className="text-sm text-gray-600 flex gap-2"><span className="text-emerald-500 shrink-0">+</span>{c}</li>
                ))}
              </ul>
            </div>
          )}
          {data.agent_disagreements && data.agent_disagreements.length > 0 && (
            <div className="card p-4">
              <h3 className="text-xs font-semibold text-amber-600 uppercase tracking-wider mb-2">Agent Disagreements</h3>
              <ul className="space-y-1.5">
                {data.agent_disagreements.map((d, i) => (
                  <li key={i} className="text-sm text-gray-600 flex gap-2"><span className="text-amber-500 shrink-0">~</span>{d}</li>
                ))}
              </ul>
            </div>
          )}
        </div>
      )}

      <QuestionsList questions={data.top_questions} title="Top Questions for Next Meeting" />

      {/* Override note */}
      {data.override && data.override !== 'null' && typeof data.override === 'object' && (
        <div className="card p-3 bg-blue-50 border-blue-200">
          <p className="text-xs text-blue-700">
            <span className="font-bold">Synthesis Override ({data.override.adjustment > 0 ? '+' : ''}{data.override.adjustment}):</span> {data.override.justification}
          </p>
        </div>
      )}
    </div>
  );
}

// ════════════════════════════════════════════════════════
// Agent Output Router
// ════════════════════════════════════════════════════════

function AgentOutput({ data, type }) {
  if (!data) return <div className="text-center py-8 text-gray-500 text-sm">Agent output not yet available</div>;
  if (data.error) return <div className="card p-4 text-sm text-red-600">Agent error: {data.error}</div>;

  if (type === 'team') return <TeamOutput data={data} />;
  if (type === 'product') return <ProductOutput data={data} />;
  if (type === 'market') return <MarketOutput data={data} />;
  if (type === 'bear') return <BearOutput data={data} />;

  // Fallback for any unknown agent type
  return (
    <div className="card p-4">
      <pre className="text-xs text-gray-500 whitespace-pre-wrap">{JSON.stringify(data, null, 2)}</pre>
    </div>
  );
}

// ════════════════════════════════════════════════════════
// TEAM Output
// ════════════════════════════════════════════════════════

function TeamOutput({ data }) {
  const v = data.verdict;
  const subs = data.subcategories;

  return (
    <div className="space-y-4">
      {/* Verdict Banner */}
      {v && (
        <div className={`rounded-xl border p-5 ${SIGNAL_BG[v.signal] || 'bg-gray-50 border-gray-200'}`}>
          <div className="flex items-start justify-between gap-4">
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-3 mb-2">
                <span className={`text-2xl font-black ${SIGNAL_TEXT[v.signal] || 'text-gray-700'}`}>{v.signal}</span>
                <span className={`text-3xl font-black ${scoreColor(v.score)}`}>{v.score}<span className="text-base font-medium text-gray-400">/10</span></span>
                {data.pillar_score && (
                  <span className="text-sm text-gray-400 font-mono ml-2">Pillar: {data.pillar_score}</span>
                )}
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
      )}

      {/* Snapshot */}
      {data.snapshot && data.snapshot.length > 0 && (
        <div className="card p-4">
          <h3 className="text-xs font-semibold text-gray-400 uppercase tracking-wider mb-2">Snapshot</h3>
          <ul className="space-y-1.5">
            {data.snapshot.map((bullet, i) => (
              <li key={i} className="text-sm text-gray-700 flex gap-2">
                <span className="text-gray-300 shrink-0">-</span><span>{bullet}</span>
              </li>
            ))}
          </ul>
        </div>
      )}

      {/* The Read */}
      {data.the_read && (
        <div className="card p-4 border-l-4 border-l-gray-900">
          <h3 className="text-xs font-semibold text-gray-400 uppercase tracking-wider mb-2">The Read</h3>
          <p className="text-sm text-gray-700 leading-relaxed">{data.the_read}</p>
        </div>
      )}

      {/* Subcategory Scores */}
      {subs && (
        <div className="card p-4">
          <h3 className="text-xs font-semibold text-gray-400 uppercase tracking-wider mb-4">Team Subcategories</h3>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {[
              { key: 'founder_problem_fit', label: 'Founder-Problem Fit', weight: '2x' },
              { key: 'sales_capability', label: 'Sales Capability', weight: '2x' },
              { key: 'velocity', label: 'Velocity & Bias to Action' },
              { key: 'storytelling_framing', label: 'Storytelling & Framing' },
              { key: 'team_composition', label: 'Team Composition' },
              { key: 'competitive_precision', label: 'Competitive Precision' },
              { key: 'missionary_conviction', label: 'Missionary Conviction' },
              // Legacy keys (old assessments)
              { key: 'founder_market_fit', label: 'Founder-Market Fit' },
              { key: 'idea_maze', label: 'Idea Maze Navigation' },
              { key: 'experience_stage_fit', label: 'Experience & Stage Fit' },
            ].map(({ key, label, weight }) => {
              const sub = subs[key];
              if (!sub) return null;
              return (
                <SubcategoryCard
                  key={key}
                  label={weight ? `${label} (${weight})` : label}
                  score={sub.score}
                  evidence={sub.evidence}
                  extras={
                    <>
                      {sub.insight_type && (
                        <span className="inline-block text-[10px] font-mono text-gray-400 mt-1">
                          {sub.insight_type === 'earned_insider' ? 'EARNED' : 'SYNTHESIZED'}
                        </span>
                      )}
                      {sub.fit_signal && (
                        <span className={`inline-block ml-2 text-[10px] font-medium px-2 py-0.5 rounded-full ${FIT_COLORS[sub.fit_signal] || 'text-gray-500 bg-gray-50'}`}>
                          {sub.fit_signal}
                        </span>
                      )}
                    </>
                  }
                />
              );
            })}
          </div>
        </div>
      )}

      {/* Key Quotes */}
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

      <RisksList risks={data.risks} />
      <QuestionsList questions={data.open_questions} />
    </div>
  );
}

// ════════════════════════════════════════════════════════
// PRODUCT Output
// ════════════════════════════════════════════════════════

function ProductOutput({ data }) {
  const subs = data.subcategories;

  return (
    <div className="space-y-4">
      {/* Pillar score header */}
      {data.pillar_score && (
        <div className="card p-4 flex items-center justify-between">
          <h3 className="text-sm font-semibold text-gray-700">Product Pillar Score</h3>
          <span className={`text-3xl font-black ${scoreColor(data.pillar_score)}`}>
            {data.pillar_score}<span className="text-base font-medium text-gray-400">/10</span>
          </span>
        </div>
      )}

      {/* Product Thesis */}
      {data.product_thesis && (
        <div className="card p-4 border-l-4 border-l-blue-500">
          <h3 className="text-xs font-semibold text-gray-400 uppercase tracking-wider mb-2">Product Thesis</h3>
          <p className="text-sm text-gray-700 leading-relaxed">{data.product_thesis}</p>
        </div>
      )}

      {/* Build vs Buy + Vision Gap */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        {data.build_vs_buy_risk && (
          <div className="card p-4">
            <h3 className="text-xs font-semibold text-gray-400 uppercase tracking-wider mb-2">Build vs. Buy Risk</h3>
            <p className="text-sm text-gray-600 leading-relaxed">{data.build_vs_buy_risk}</p>
          </div>
        )}
        {data.vision_gap && (
          <div className="card p-4">
            <h3 className="text-xs font-semibold text-gray-400 uppercase tracking-wider mb-2">Vision Gap</h3>
            <p className="text-sm text-gray-600 leading-relaxed">{data.vision_gap}</p>
          </div>
        )}
      </div>

      {/* Subcategory Scores */}
      {subs && (
        <div className="card p-4">
          <h3 className="text-xs font-semibold text-gray-400 uppercase tracking-wider mb-4">Product Subcategories</h3>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {[
              { key: 'product_velocity', label: 'Product Velocity' },
              { key: 'customer_proximity', label: 'Customer Proximity' },
              { key: 'focus_prioritization', label: 'Focus & Prioritization' },
              { key: 'moat_architecture', label: 'Moat Architecture' },
              { key: 'flywheel_design', label: 'Flywheel Design' },
              // Legacy keys (old assessments)
              { key: 'technical_defensibility', label: 'Technical Defensibility' },
              { key: 'product_market_intuition', label: 'Product-Market Intuition' },
            ].map(({ key, label }) => {
              const sub = subs[key];
              if (!sub) return null;
              return <SubcategoryCard key={key} label={label} score={sub.score} evidence={sub.evidence} />;
            })}
          </div>
        </div>
      )}

      <RisksList risks={data.risks} />
      <QuestionsList questions={data.key_questions} />
    </div>
  );
}

// ════════════════════════════════════════════════════════
// MARKET Output
// ════════════════════════════════════════════════════════

function MarketOutput({ data }) {
  const subs = data.subcategories;

  return (
    <div className="space-y-4">
      {/* Pillar score header */}
      {data.pillar_score && (
        <div className="card p-4 flex items-center justify-between">
          <h3 className="text-sm font-semibold text-gray-700">Market Pillar Score</h3>
          <span className={`text-3xl font-black ${scoreColor(data.pillar_score)}`}>
            {data.pillar_score}<span className="text-base font-medium text-gray-400">/10</span>
          </span>
        </div>
      )}

      {/* Why Now */}
      {data.why_now && (
        <div className="card p-4 border-l-4 border-l-blue-500">
          <h3 className="text-xs font-semibold text-gray-400 uppercase tracking-wider mb-2">Why Now</h3>
          <p className="text-sm text-gray-700 leading-relaxed">{data.why_now}</p>
        </div>
      )}

      {/* Competitive Moat + Kill Shot */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        {data.competitive_moat && (
          <div className="card p-4">
            <h3 className="text-xs font-semibold text-gray-400 uppercase tracking-wider mb-2">Competitive Moat</h3>
            <p className="text-sm text-gray-600 leading-relaxed">{data.competitive_moat}</p>
          </div>
        )}
        {data.kill_shot_risk && (
          <div className="card p-4 border-red-200">
            <h3 className="text-xs font-semibold text-red-600 uppercase tracking-wider mb-2">Kill Shot Risk</h3>
            <p className="text-sm text-gray-600 leading-relaxed">{data.kill_shot_risk}</p>
          </div>
        )}
      </div>

      {/* Subcategory Scores */}
      {subs && (
        <div className="card p-4">
          <h3 className="text-xs font-semibold text-gray-400 uppercase tracking-wider mb-4">Market Subcategories</h3>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {[
              { key: 'market_timing', label: 'Market Timing' },
              { key: 'market_structure', label: 'Market Structure' },
              { key: 'incumbent_conflict_mapping', label: 'Incumbent Conflict Mapping' },
              { key: 'tam_realism', label: 'TAM Realism' },
              { key: 'unit_economics_structure', label: 'Unit Economics Structure' },
              { key: 'category_momentum', label: 'Category Momentum' },
              { key: 'neutral_layer_viability', label: 'Neutral Layer Viability' },
              // Legacy keys (old assessments)
              { key: 'competitive_landscape', label: 'Competitive Landscape' },
            ].map(({ key, label }) => {
              const sub = subs[key];
              if (!sub) return null;
              return <SubcategoryCard key={key} label={label} score={sub.score} evidence={sub.evidence} />;
            })}
          </div>
        </div>
      )}

      <RisksList risks={data.risks} />
      <QuestionsList questions={data.key_questions} />
    </div>
  );
}

// ════════════════════════════════════════════════════════
// BEAR Output
// ════════════════════════════════════════════════════════

function BearOutput({ data }) {
  return (
    <div className="space-y-4">
      {/* Bear adjustment badge */}
      {data.bear_adjustment != null && (
        <div className="card p-4 flex items-center justify-between bg-red-50 border-red-200">
          <span className="text-sm font-semibold text-red-700">Bear Score Adjustment</span>
          <span className="text-2xl font-black text-red-600">{data.bear_adjustment}</span>
        </div>
      )}

      {/* Kill shot */}
      {data.kill_shot_risk && (
        <div className="card p-4 border-l-4 border-l-red-500">
          <h3 className="text-xs font-semibold text-red-600 uppercase tracking-wider mb-2">Kill Shot Risk</h3>
          <p className="text-sm text-gray-700 leading-relaxed">{data.kill_shot_risk}</p>
        </div>
      )}

      {/* 12-Month Kill scenario */}
      {data.twelve_month_kill && (
        <div className="card p-4 border-l-4 border-l-orange-400">
          <div className="flex items-center justify-between mb-2">
            <h3 className="text-xs font-semibold text-orange-600 uppercase tracking-wider">12-Month Kill Scenario</h3>
            {data.twelve_month_kill.probability && (
              <span className="text-xs font-bold text-orange-700 bg-orange-50 px-2 py-0.5 rounded">{data.twelve_month_kill.probability}</span>
            )}
          </div>
          {data.twelve_month_kill.scenario && <p className="text-sm text-gray-700 leading-relaxed">{data.twelve_month_kill.scenario}</p>}
          {data.twelve_month_kill.evidence && <p className="text-xs text-gray-500 mt-1">{data.twelve_month_kill.evidence}</p>}
        </div>
      )}

      {/* Bundling Risk */}
      {data.bundling_risk && (
        <div className="card p-4 border-l-4 border-l-amber-400">
          <div className="flex items-center justify-between mb-2">
            <h3 className="text-xs font-semibold text-amber-600 uppercase tracking-wider">Bundling Risk</h3>
            {data.bundling_risk.severity && (
              <span className="text-xs font-bold text-amber-700 bg-amber-50 px-2 py-0.5 rounded">{data.bundling_risk.severity}</span>
            )}
          </div>
          {data.bundling_risk.scenario && <p className="text-sm text-gray-700 leading-relaxed">{data.bundling_risk.scenario}</p>}
          {data.bundling_risk.evidence && <p className="text-xs text-gray-500 mt-1">{data.bundling_risk.evidence}</p>}
        </div>
      )}

      {/* Narrative */}
      {data.narrative && (
        <div className="card p-4">
          <h3 className="text-xs font-semibold text-gray-400 uppercase tracking-wider mb-2">Bear Case</h3>
          <p className="text-sm text-gray-600 whitespace-pre-wrap leading-relaxed">{data.narrative}</p>
        </div>
      )}

      {/* Primary risks */}
      {data.primary_risks && data.primary_risks.length > 0 && (
        <div className="card p-4">
          <h3 className="text-xs font-semibold text-red-600 uppercase tracking-wider mb-3">Primary Risks</h3>
          <div className="space-y-3">
            {data.primary_risks.map((r, i) => (
              <div key={i} className="bg-gray-50 rounded-lg p-3">
                <div className="flex items-center gap-2 mb-1">
                  <span className={`text-[10px] font-bold uppercase px-1.5 py-0.5 rounded ${
                    r.severity === 'high' ? 'bg-red-100 text-red-700' :
                    r.severity === 'medium' ? 'bg-amber-100 text-amber-700' :
                    'bg-gray-100 text-gray-600'
                  }`}>{r.severity}</span>
                  <span className="text-sm font-medium text-gray-800">{r.risk}</span>
                </div>
                {r.detail && <p className="text-xs text-gray-500 mt-1">{r.detail}</p>}
                {r.mitigation && <p className="text-xs text-gray-400 mt-1">Mitigation: {r.mitigation}</p>}
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Failure scenarios */}
      {data.failure_scenarios && data.failure_scenarios.length > 0 && (
        <div className="card p-4">
          <h3 className="text-xs font-semibold text-gray-400 uppercase tracking-wider mb-2">Failure Scenarios</h3>
          <ul className="text-sm text-gray-600 space-y-1.5">
            {data.failure_scenarios.map((s, i) => <li key={i} className="flex gap-2"><span className="text-red-400 shrink-0">-</span> {s}</li>)}
          </ul>
        </div>
      )}

      {/* Deck omissions */}
      {data.deck_omissions && data.deck_omissions.length > 0 && (
        <div className="card p-4">
          <h3 className="text-xs font-semibold text-gray-400 uppercase tracking-wider mb-2">Deck Omissions</h3>
          <ul className="text-sm text-gray-600 space-y-1.5">
            {data.deck_omissions.map((o, i) => <li key={i} className="flex gap-2"><span className="text-amber-500 shrink-0">?</span> {o}</li>)}
          </ul>
        </div>
      )}

      {/* Assumptions */}
      {data.assumptions_required && data.assumptions_required.length > 0 && (
        <div className="card p-4">
          <h3 className="text-xs font-semibold text-gray-400 uppercase tracking-wider mb-3">Required Assumptions</h3>
          <div className="space-y-2">
            {data.assumptions_required.map((a, i) => (
              <div key={i} className="flex items-start gap-2">
                <span className={`text-[10px] font-bold uppercase px-1.5 py-0.5 rounded shrink-0 mt-0.5 ${
                  a.likelihood === 'high' ? 'bg-emerald-100 text-emerald-700' :
                  a.likelihood === 'medium' ? 'bg-amber-100 text-amber-700' :
                  'bg-red-100 text-red-700'
                }`}>{a.likelihood}</span>
                <p className="text-sm text-gray-700">{a.assumption}</p>
              </div>
            ))}
          </div>
        </div>
      )}

      <QuestionsList questions={data.key_questions} />
    </div>
  );
}

// ════════════════════════════════════════════════════════
// Steward-Operator Rubric View
// ════════════════════════════════════════════════════════

function RubricTraitRow({ label, score, evidence }) {
  const [open, setOpen] = useState(false);
  const s = typeof score === 'number' ? score : 5;
  return (
    <div className="bg-gray-50 rounded-lg p-3">
      <div className="flex items-center justify-between mb-2">
        <button
          onClick={() => setOpen(!open)}
          className="text-sm font-semibold text-gray-700 hover:text-gray-900 text-left flex-1"
        >
          <span className="text-gray-300 mr-1">{open ? '-' : '+'}</span>
          {label}
        </button>
        <span className={`text-lg font-black ${scoreColor(s)}`}>{s}<span className="text-xs font-medium text-gray-400">/10</span></span>
      </div>
      <div className="w-full bg-gray-200 rounded-full h-1 mb-2">
        <div className={`h-1 rounded-full ${scoreBg(s)}`} style={{ width: `${s * 10}%` }} />
      </div>
      {open && evidence && (
        <p className="text-xs text-gray-500 leading-relaxed mt-2">{evidence}</p>
      )}
    </div>
  );
}

function RubricView({ rubric, assessmentComplete, onRun, running }) {
  if (!assessmentComplete) {
    return (
      <div className="text-center py-8 text-gray-500 text-sm">
        The Steward-Operator rubric runs after the main assessment completes.
      </div>
    );
  }

  if (!rubric) {
    return (
      <div className="card p-6 text-center">
        <h3 className="text-sm font-semibold text-gray-800 mb-1">Steward-Operator Rubric</h3>
        <p className="text-xs text-gray-500 mb-4 max-w-md mx-auto">
          A 9-trait diagnostic overlay that scores operating discipline under capital trust. Supplements the main assessment.
        </p>
        <button
          onClick={onRun}
          disabled={running}
          className="inline-flex items-center px-4 py-2 rounded-md bg-gray-900 text-white text-sm font-medium hover:bg-gray-800 disabled:opacity-50"
        >
          {running ? 'Starting...' : 'Run Steward-Operator Rubric'}
        </button>
      </div>
    );
  }

  if (rubric.status === 'running' || rubric.status === 'pending') {
    return (
      <div className="card p-6 text-center">
        <p className="text-sm text-gray-600 animate-pulse">Scoring against the 9-trait rubric...</p>
      </div>
    );
  }

  if (rubric.status === 'error') {
    return (
      <div className="card p-4 bg-red-50 border-red-200">
        <p className="text-sm text-red-700 font-semibold">Rubric run failed</p>
        {rubric.error && <p className="text-xs text-red-600 mt-1">{rubric.error}</p>}
        <button
          onClick={onRun}
          disabled={running}
          className="mt-3 text-xs text-red-700 hover:text-red-900 underline"
        >
          Retry
        </button>
      </div>
    );
  }

  const data = (() => {
    try { return typeof rubric.output === 'string' ? JSON.parse(rubric.output) : rubric.output; }
    catch { return null; }
  })();

  if (!data) {
    return <div className="text-center py-8 text-gray-500 text-sm">Could not parse rubric output</div>;
  }

  const threshold = data.threshold || rubric.threshold || 'Pass';
  const style = THRESHOLD_STYLES[threshold] || THRESHOLD_STYLES['Pass'];
  const overallScore = data.overall_score ?? rubric.overall_score ?? 0;
  const hitsCount = data.hits_count ?? 0;
  const flagged = data.flagged ?? !!rubric.flagged;

  return (
    <div className="space-y-4">
      {flagged && (
        <div className="rounded-xl border-2 border-purple-400 bg-purple-50 p-4">
          <div className="flex items-center gap-3">
            <span className="text-xl">*</span>
            <div>
              <p className="text-sm font-bold text-purple-800 uppercase tracking-wider">Flagged for Review</p>
              <p className="text-xs text-purple-700 mt-0.5">Overall score of {overallScore}/9 clears the review threshold.</p>
            </div>
          </div>
        </div>
      )}

      <div className={`rounded-xl border p-5 ${style.bg}`}>
        <div className="flex items-start justify-between gap-4">
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-3 mb-2">
              <span className={`text-3xl font-black ${style.text}`}>
                {overallScore}<span className="text-base font-medium text-gray-400">/9</span>
              </span>
              <span className={`text-xs font-bold uppercase tracking-wider px-2 py-1 rounded ${style.badge}`}>
                {threshold}
              </span>
            </div>
            <p className="text-xs text-gray-600 mt-1">{hitsCount} of 9 traits scored {'>='} 7</p>
            {data.summary && <p className="text-sm text-gray-800 font-medium leading-snug mt-3">{data.summary}</p>}
          </div>
          <button
            onClick={onRun}
            disabled={running}
            className="text-xs text-gray-500 hover:text-gray-700 underline shrink-0"
          >
            Re-run
          </button>
        </div>
      </div>

      <div className="card p-4">
        <h3 className="text-xs font-semibold text-gray-400 uppercase tracking-wider mb-3">9 Traits</h3>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
          {RUBRIC_TRAITS.map(({ key, label }) => {
            const t = data.traits?.[key] || {};
            return <RubricTraitRow key={key} label={label} score={t.score} evidence={t.evidence} />;
          })}
        </div>
      </div>

      <div className="card p-4">
        <h3 className="text-xs font-semibold text-gray-400 uppercase tracking-wider mb-3">Tiebreakers</h3>
        <div className="space-y-3">
          {[
            { key: 't1_names_weakness_unprompted', label: 'T1 — Names own weakness unprompted' },
            { key: 't2_tailors_ask_with_specificity', label: 'T2 — Tailors investor ask with specificity' },
          ].map(({ key, label }) => {
            const tb = data.tiebreakers?.[key] || {};
            const passed = !!tb.passed;
            return (
              <div key={key} className="flex items-start gap-3">
                <span className={`text-[10px] font-bold uppercase px-2 py-0.5 rounded shrink-0 mt-0.5 ${passed ? 'bg-emerald-100 text-emerald-700' : 'bg-gray-200 text-gray-600'}`}>
                  {passed ? 'Pass' : 'Fail'}
                </span>
                <div className="flex-1">
                  <p className="text-sm font-semibold text-gray-700">{label}</p>
                  {tb.evidence && <p className="text-xs text-gray-500 mt-0.5">{tb.evidence}</p>}
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
