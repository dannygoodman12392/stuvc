import { useState, useEffect } from 'react';
import { useParams, Link } from 'react-router-dom';
import { api } from '../utils/api';

const TABS = [
  { key: 'synthesis', label: 'Synthesis' },
  { key: 'founder', label: 'Founder' },
  { key: 'market', label: 'Market' },
  { key: 'economics', label: 'Economics' },
  { key: 'pattern', label: 'Pattern' },
  { key: 'bear', label: 'Bear' },
];

export default function AssessmentDetail() {
  const { id } = useParams();
  const [assessment, setAssessment] = useState(null);
  const [loading, setLoading] = useState(true);
  const [activeTab, setActiveTab] = useState('synthesis');
  const [pollInterval, setPollInterval] = useState(null);

  useEffect(() => {
    loadAssessment();
    return () => { if (pollInterval) clearInterval(pollInterval); };
  }, [id]);

  async function loadAssessment() {
    try {
      const a = await api.getAssessment(id);
      setAssessment(a);

      if (a.status === 'running' || a.status === 'synthesizing') {
        const interval = setInterval(async () => {
          const updated = await api.getAssessment(id);
          setAssessment(updated);
          if (updated.status === 'complete' || updated.status === 'partial' || updated.status === 'error') {
            clearInterval(interval);
          }
        }, 3000);
        setPollInterval(interval);
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

  if (loading) return <div className="text-center py-12 text-gray-500 text-sm">Loading assessment...</div>;
  if (!assessment) return <div className="text-center py-12 text-gray-500 text-sm">Assessment not found</div>;

  const synthesis = parseOutput(assessment.synthesis_output);
  const founderOut = parseOutput(assessment.founder_agent_output);
  const marketOut = parseOutput(assessment.market_agent_output);
  const economicsOut = parseOutput(assessment.economics_agent_output);
  const patternOut = parseOutput(assessment.pattern_agent_output);
  const bearOut = parseOutput(assessment.bear_agent_output);

  const SIGNAL_COLORS = {
    'Strong Pass': 'text-emerald-600',
    'Pass': 'text-blue-600',
    'Watch': 'text-amber-600',
    'Pass On': 'text-red-600',
  };

  return (
    <div>
      <div className="flex items-center gap-2 text-sm text-gray-400 mb-6">
        <Link to="/assess" className="hover:text-gray-600">Assess</Link>
        <span>/</span>
        <span className="text-gray-700">{assessment.founder_name || `Assessment #${id}`}</span>
      </div>

      {/* Header */}
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-xl font-bold text-gray-900">
            {assessment.founder_name || 'Opportunity Assessment'}
            {assessment.founder_company && <span className="text-gray-400 font-normal ml-2">({assessment.founder_company})</span>}
          </h1>
          <p className="text-sm text-gray-500 mt-0.5">
            {assessment.status === 'running' && 'Agents running...'}
            {assessment.status === 'synthesizing' && 'Synthesizing results...'}
            {assessment.status === 'complete' && `Completed ${new Date(assessment.updated_at).toLocaleDateString()}`}
            {assessment.status === 'partial' && 'Partial results (some agents failed)'}
            {assessment.status === 'error' && 'Assessment failed'}
          </p>
        </div>
        {assessment.overall_signal && (
          <div className={`text-lg font-bold ${SIGNAL_COLORS[assessment.overall_signal] || 'text-gray-400'}`}>
            {assessment.overall_signal}
          </div>
        )}
      </div>

      {/* Running indicator */}
      {(assessment.status === 'running' || assessment.status === 'synthesizing') && (
        <div className="card p-4 mb-6">
          <div className="flex items-center gap-3">
            <svg className="w-5 h-5 animate-spin text-blue-600" fill="none" viewBox="0 0 24 24">
              <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
              <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
            </svg>
            <span className="text-sm text-gray-600">
              {assessment.status === 'running' ? 'Five agents analyzing your opportunity in parallel...' : 'Synthesizing all agent outputs...'}
            </span>
          </div>
        </div>
      )}

      {/* Tabs */}
      <div className="flex gap-1 mb-6 bg-gray-100 rounded-lg p-1 overflow-x-auto">
        {TABS.map(tab => (
          <button
            key={tab.key}
            onClick={() => setActiveTab(tab.key)}
            className={`px-4 py-1.5 rounded-md text-sm font-medium transition-colors whitespace-nowrap ${
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
            <div className="text-center py-8 text-gray-500 text-sm">Synthesis not yet available</div>
          )
        )}

        {activeTab === 'founder' && <AgentOutput data={founderOut} type="founder" />}
        {activeTab === 'market' && <AgentOutput data={marketOut} type="market" />}
        {activeTab === 'economics' && <AgentOutput data={economicsOut} type="economics" />}
        {activeTab === 'pattern' && <AgentOutput data={patternOut} type="pattern" />}
        {activeTab === 'bear' && <AgentOutput data={bearOut} type="bear" />}
      </div>
    </div>
  );
}

function AgentOutput({ data, type }) {
  if (!data) return <div className="text-center py-8 text-gray-500 text-sm">Agent output not yet available</div>;
  if (data.error) return <div className="card p-4 text-sm text-red-600">Agent error: {data.error}</div>;

  return (
    <div className="space-y-4">
      {data.narrative && (
        <div className="card p-4">
          <h3 className="text-sm font-semibold text-gray-700 mb-2">Analysis</h3>
          <p className="text-sm text-gray-600 whitespace-pre-wrap">{data.narrative}</p>
        </div>
      )}

      {/* Founder-specific */}
      {type === 'founder' && data.trait_scores && (
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
              </div>
            ))}
          </div>
        </div>
      )}

      {type === 'founder' && data.stage_classification && (
        <div className="card p-4 flex items-center gap-4">
          <div>
            <p className="text-xs text-gray-500 uppercase tracking-wider">Stage Classification</p>
            <p className="text-sm font-medium text-gray-900 mt-0.5">{data.stage_classification}</p>
          </div>
          <div>
            <p className="text-xs text-gray-500 uppercase tracking-wider">Insight Type</p>
            <p className="text-sm font-medium text-gray-900 mt-0.5">{data.founding_insight_type?.replace('_', ' ')}</p>
          </div>
          {data.overall_signal && (
            <div>
              <p className="text-xs text-gray-500 uppercase tracking-wider">Signal</p>
              <p className={`text-sm font-medium mt-0.5 ${data.overall_signal === 'Strong Pass' ? 'text-emerald-600' : data.overall_signal === 'Pass' ? 'text-blue-600' : data.overall_signal === 'Watch' ? 'text-amber-600' : 'text-red-500'}`}>{data.overall_signal}</p>
            </div>
          )}
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
                <p className={`text-lg font-bold ${(val.score || val) >= 7 ? 'text-emerald-600' : (val.score || val) >= 5 ? 'text-amber-600' : 'text-red-500'}`}>
                  {val.score || val}/10
                </p>
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

      {/* Pattern-specific */}
      {type === 'pattern' && data.pattern_matches && (
        <div className="card p-4">
          <h3 className="text-sm font-semibold text-gray-700 mb-3">Pattern Matches</h3>
          {data.pattern_matches.map((p, i) => (
            <div key={i} className="flex items-start gap-2 mb-2">
              <span className={`badge ${p.verdict === 'strong_match' ? 'badge-green' : p.verdict === 'partial_match' ? 'badge-amber' : 'badge-red'}`}>
                {p.verdict?.replace('_', ' ')}
              </span>
              <div>
                <p className="text-sm text-gray-700">{p.pattern}</p>
                {p.evidence && <p className="text-xs text-gray-500 mt-0.5">{p.evidence}</p>}
              </div>
            </div>
          ))}
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
