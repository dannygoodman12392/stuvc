import { useState, useEffect } from 'react';
import { useParams, Link, useNavigate } from 'react-router-dom';
import { api } from '../../utils/api';
import TagInput from '../../components/TagInput';
import { useToast } from '../../components/Toast';

function ScorePill({ label, value }) {
  if (value == null) return null;
  return (
    <div className="flex flex-col items-center px-3 py-2 bg-gray-50 rounded-lg">
      <div className="text-[10px] uppercase tracking-wide text-gray-500">{label}</div>
      <div className="text-lg font-semibold text-gray-900 tabular-nums">{value}<span className="text-xs text-gray-400">/10</span></div>
    </div>
  );
}

export default function TalentCandidateDetail() {
  const { id } = useParams();
  const navigate = useNavigate();
  const [candidate, setCandidate] = useState(null);
  const { toast } = useToast();

  async function load() {
    try {
      const c = await api.getTalentCandidate(id);
      setCandidate(c);
    } catch (err) {
      toast({ message: err.message, tone: 'error' });
    }
  }
  useEffect(() => { load(); }, [id]);

  async function patch(fields) {
    try {
      const updated = await api.updateTalentCandidate(id, fields);
      setCandidate(c => ({ ...c, ...updated }));
    } catch (err) {
      toast({ message: err.message, tone: 'error' });
    }
  }

  async function remove() {
    if (!confirm('Delete this candidate?')) return;
    try {
      await api.deleteTalentCandidate(id);
      navigate('/talent/candidates');
    } catch (err) {
      toast({ message: err.message, tone: 'error' });
    }
  }

  if (!candidate) return <div className="text-sm text-gray-400">Loading...</div>;

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <Link to="/talent/candidates" className="text-sm text-gray-500 hover:text-gray-700">← Candidates</Link>
        <div className="flex gap-2">
          <button onClick={() => patch({ starred: candidate.starred ? 0 : 1 })} className={`btn-ghost text-xs ${candidate.starred ? 'text-amber-600' : ''}`}>
            {candidate.starred ? '★ Starred' : '☆ Star'}
          </button>
          <button onClick={remove} className="btn-danger text-xs">Delete</button>
        </div>
      </div>

      <div>
        <h1 className="text-2xl font-semibold text-gray-900 tracking-tight">{candidate.name}</h1>
        {candidate.headline && <p className="text-sm text-gray-600 mt-1">{candidate.headline}</p>}
        <div className="flex flex-wrap gap-3 text-xs text-gray-500 mt-2">
          {candidate.linkedin_url && <a href={candidate.linkedin_url} target="_blank" rel="noopener noreferrer" className="hover:text-amber-700">LinkedIn ↗</a>}
          {candidate.github_url && <a href={candidate.github_url} target="_blank" rel="noopener noreferrer" className="hover:text-amber-700">GitHub ↗</a>}
          {candidate.twitter_url && <a href={candidate.twitter_url} target="_blank" rel="noopener noreferrer" className="hover:text-amber-700">Twitter ↗</a>}
          {candidate.website_url && <a href={candidate.website_url} target="_blank" rel="noopener noreferrer" className="hover:text-amber-700">Website ↗</a>}
          {candidate.email && <span>{candidate.email}</span>}
        </div>
      </div>

      <div className="grid grid-cols-2 md:grid-cols-5 gap-2">
        <ScorePill label="Overall" value={candidate.overall_score} />
        <ScorePill label="Build" value={candidate.score_build_caliber} />
        <ScorePill label="Leap" value={candidate.score_leap_readiness} />
        <ScorePill label="Domain" value={candidate.score_domain_fit} />
        <ScorePill label="Geo" value={candidate.score_geography} />
      </div>

      <div className="card p-5 space-y-3">
        <h2 className="text-sm font-semibold text-gray-900">Current role</h2>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
          <div>
            <label className="label">Company</label>
            <input className="input w-full" defaultValue={candidate.current_company || ''} onBlur={e => patch({ current_company: e.target.value })} />
          </div>
          <div>
            <label className="label">Role</label>
            <input className="input w-full" defaultValue={candidate.current_role || ''} onBlur={e => patch({ current_role: e.target.value })} />
          </div>
          <div>
            <label className="label">Location</label>
            <input className="input w-full" defaultValue={candidate.location_city || ''} onBlur={e => patch({ location_city: e.target.value })} />
          </div>
          <div>
            <label className="label">Tenure (months)</label>
            <input type="number" className="input w-full" defaultValue={candidate.tenure_months || ''} onBlur={e => patch({ tenure_months: e.target.value ? parseInt(e.target.value) : null })} />
          </div>
        </div>
      </div>

      <div className="card p-5 space-y-4">
        <h2 className="text-sm font-semibold text-gray-900">Signals</h2>
        <div>
          <label className="label">Tech stack</label>
          <TagInput tags={candidate.tech_stack || []} onChange={v => patch({ tech_stack: v })} accent="amber" />
        </div>
        <div>
          <label className="label">Pedigree</label>
          <TagInput tags={candidate.pedigree_signals || []} onChange={v => patch({ pedigree_signals: v })} accent="amber" />
        </div>
        <div>
          <label className="label">Builder signals</label>
          <TagInput tags={candidate.builder_signals || []} onChange={v => patch({ builder_signals: v })} accent="amber" />
        </div>
        <div>
          <label className="label">Leap signals</label>
          <TagInput tags={candidate.leap_signals || []} onChange={v => patch({ leap_signals: v })} accent="amber" />
        </div>
        <div>
          <label className="label">Band fit</label>
          <TagInput tags={candidate.band_fit || []} onChange={v => patch({ band_fit: v })} accent="amber" placeholder="A, B, C" />
        </div>
      </div>

      {candidate.score_rationale && (
        <div className="card p-5">
          <h2 className="text-sm font-semibold text-gray-900 mb-2">Score rationale</h2>
          <p className="text-sm text-gray-700 whitespace-pre-wrap">{candidate.score_rationale}</p>
        </div>
      )}

      <div className="card p-5">
        <h2 className="text-sm font-semibold text-gray-900 mb-2">Notes</h2>
        <textarea
          className="input w-full font-mono text-xs"
          rows={5}
          defaultValue={candidate.notes || ''}
          onBlur={e => patch({ notes: e.target.value })}
          placeholder="Your observations, convo notes, flags..."
        />
      </div>

      {candidate.matches && candidate.matches.length > 0 && (
        <div>
          <h2 className="text-sm font-semibold text-gray-900 mb-3">Matches ({candidate.matches.length})</h2>
          <div className="card divide-y divide-gray-100">
            {candidate.matches.map(m => (
              <Link key={m.id} to={`/talent/roles/${m.role_id}`} className="flex items-center gap-4 px-4 py-3 hover:bg-gray-50">
                <div className="w-10 h-10 rounded-full bg-amber-50 border border-amber-100 flex items-center justify-center text-amber-700 font-semibold text-sm tabular-nums flex-shrink-0">
                  {m.match_score}
                </div>
                <div className="flex-1 min-w-0">
                  <div className="text-sm font-medium text-gray-900">{m.role_title}</div>
                  <div className="text-xs text-gray-500">Band {m.role_band}{m.company_name ? ` · ${m.company_name}` : ''}</div>
                </div>
                <span className="badge badge-gray text-[10px]">{m.status}</span>
              </Link>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
