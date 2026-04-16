import { useState, useEffect } from 'react';
import { useParams, Link, useNavigate } from 'react-router-dom';
import { api } from '../../utils/api';
import TagInput from '../../components/TagInput';
import { useToast } from '../../components/Toast';

export default function TalentRoleDetail() {
  const { id } = useParams();
  const navigate = useNavigate();
  const [role, setRole] = useState(null);
  const [saving, setSaving] = useState(false);
  const [rematching, setRematching] = useState(false);
  const [sourcing, setSourcing] = useState(false);
  const { toast } = useToast();

  async function load() {
    try {
      const r = await api.getTalentRole(id);
      setRole(r);
    } catch (err) {
      toast({ message: err.message, tone: 'error' });
    }
  }
  useEffect(() => { load(); }, [id]);

  async function patch(fields) {
    setSaving(true);
    try {
      const updated = await api.updateTalentRole(id, fields);
      setRole(r => ({ ...r, ...updated }));
    } catch (err) {
      toast({ message: err.message, tone: 'error' });
    } finally {
      setSaving(false);
    }
  }

  async function rematch() {
    setRematching(true);
    try {
      await api.triggerTalentMatching({ role_id: parseInt(id) });
      toast({ message: 'Rescoring matches against all candidates...' });
      setTimeout(load, 2000);
    } catch (err) {
      toast({ message: err.message, tone: 'error' });
    } finally {
      setRematching(false);
    }
  }

  async function sourceForRole() {
    setSourcing(true);
    try {
      await api.triggerTalentSourcing({ role_id: parseInt(id) });
      const locMsg = role.location_pref
        ? ` (strict: ${role.location_pref}${role.remote_ok ? ' or remote' : ''})`
        : '';
      toast({ message: `Sourcing started for this role${locMsg}. Check candidates in a few minutes.` });
    } catch (err) {
      toast({ message: err.message, tone: 'error' });
    } finally {
      setSourcing(false);
    }
  }

  async function remove() {
    if (!confirm('Delete this role?')) return;
    try {
      await api.deleteTalentRole(id);
      navigate('/talent/roles');
      toast({ message: 'Role deleted' });
    } catch (err) {
      toast({ message: err.message, tone: 'error' });
    }
  }

  if (!role) return <div className="text-sm text-gray-400">Loading...</div>;

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <Link to="/talent/roles" className="text-sm text-gray-500 hover:text-gray-700">← Roles</Link>
        <div className="flex gap-2">
          <button onClick={sourceForRole} disabled={sourcing} className="btn-primary text-xs">
            {sourcing ? 'Starting...' : 'Source for this role'}
          </button>
          <button onClick={rematch} disabled={rematching} className="btn-secondary text-xs">
            {rematching ? 'Rescoring...' : 'Rescore matches'}
          </button>
          <button onClick={remove} className="btn-danger text-xs">Delete</button>
        </div>
      </div>

      <div>
        <input
          defaultValue={role.title}
          onBlur={e => { if (e.target.value !== role.title) patch({ title: e.target.value }); }}
          className="text-2xl font-semibold text-gray-900 tracking-tight w-full bg-transparent border-none outline-none focus:bg-gray-50 px-2 py-1 -mx-2 rounded"
        />
        <div className="text-sm text-gray-500 mt-1">
          {role.company_name && <Link to={`/talent/portfolio/${role.portfolio_company_id}`} className="hover:text-amber-700">{role.company_name}</Link>}
          {role.company_one_liner && <span> · {role.company_one_liner}</span>}
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
        <div className="card p-3">
          <div className="text-[10px] uppercase text-gray-500 font-medium">Band</div>
          <select value={role.band || 'A'} onChange={e => patch({ band: e.target.value })} className="select w-full mt-1">
            <option value="A">A — Cofounder / Founding</option>
            <option value="B">B — First-5</option>
            <option value="C">C — Domain Expert</option>
          </select>
        </div>
        <div className="card p-3">
          <div className="text-[10px] uppercase text-gray-500 font-medium">Status</div>
          <select value={role.status || 'open'} onChange={e => patch({ status: e.target.value })} className="select w-full mt-1">
            <option value="open">Open</option>
            <option value="paused">Paused</option>
            <option value="filled">Filled</option>
            <option value="closed">Closed</option>
          </select>
        </div>
        <div className="card p-3">
          <div className="text-[10px] uppercase text-gray-500 font-medium">Priority</div>
          <select value={role.priority || 'normal'} onChange={e => patch({ priority: e.target.value })} className="select w-full mt-1">
            <option value="urgent">Urgent</option>
            <option value="normal">Normal</option>
            <option value="low">Low</option>
          </select>
        </div>
      </div>

      <div className="card p-5 space-y-4">
        <h2 className="text-sm font-semibold text-gray-900">Requirements</h2>
        <div>
          <label className="label">Stack</label>
          <TagInput tags={role.stack_requirements || []} onChange={v => patch({ stack_requirements: v })} placeholder="e.g. Python, PyTorch" accent="amber" />
        </div>
        <div>
          <label className="label">Domain</label>
          <TagInput tags={role.domain_requirements || []} onChange={v => patch({ domain_requirements: v })} placeholder="e.g. Healthtech" accent="amber" />
        </div>
        <div>
          <label className="label">Must-haves</label>
          <TagInput tags={role.must_haves || []} onChange={v => patch({ must_haves: v })} placeholder="Non-negotiables" accent="amber" />
        </div>
        <div>
          <label className="label">Nice-to-haves</label>
          <TagInput tags={role.nice_to_haves || []} onChange={v => patch({ nice_to_haves: v })} placeholder="Bonus signals" accent="amber" />
        </div>

        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
          <div>
            <label className="label">Min YoE</label>
            <input type="number" className="input w-full" defaultValue={role.min_years_experience || ''} onBlur={e => patch({ min_years_experience: e.target.value ? parseInt(e.target.value) : null })} />
          </div>
          <div>
            <label className="label">Max YoE</label>
            <input type="number" className="input w-full" defaultValue={role.max_years_experience || ''} onBlur={e => patch({ max_years_experience: e.target.value ? parseInt(e.target.value) : null })} />
          </div>
          <div>
            <label className="label">Location pref</label>
            <input className="input w-full" defaultValue={role.location_pref || ''} onBlur={e => patch({ location_pref: e.target.value })} />
          </div>
          <div className="flex items-end">
            <label className="flex items-center gap-2 text-sm pb-2">
              <input type="checkbox" checked={!!role.remote_ok} onChange={e => patch({ remote_ok: e.target.checked ? 1 : 0 })} />
              Remote OK
            </label>
          </div>
          <div>
            <label className="label">Comp low</label>
            <input type="number" className="input w-full" defaultValue={role.comp_low || ''} onBlur={e => patch({ comp_low: e.target.value ? parseInt(e.target.value) : null })} />
          </div>
          <div>
            <label className="label">Comp high</label>
            <input type="number" className="input w-full" defaultValue={role.comp_high || ''} onBlur={e => patch({ comp_high: e.target.value ? parseInt(e.target.value) : null })} />
          </div>
          <div>
            <label className="label">Equity low %</label>
            <input type="number" step="0.01" className="input w-full" defaultValue={role.equity_low || ''} onBlur={e => patch({ equity_low: e.target.value ? parseFloat(e.target.value) : null })} />
          </div>
          <div>
            <label className="label">Equity high %</label>
            <input type="number" step="0.01" className="input w-full" defaultValue={role.equity_high || ''} onBlur={e => patch({ equity_high: e.target.value ? parseFloat(e.target.value) : null })} />
          </div>
        </div>
      </div>

      <div className="card p-5">
        <h2 className="text-sm font-semibold text-gray-900 mb-2">Job description</h2>
        <textarea
          className="input w-full font-mono text-xs"
          rows={10}
          defaultValue={role.jd_content || ''}
          onBlur={e => patch({ jd_content: e.target.value })}
          placeholder="Paste or write the JD (Markdown)..."
        />
      </div>

      <div>
        <div className="flex items-center justify-between mb-3">
          <h2 className="text-sm font-semibold text-gray-900">Matches ({role.matches?.length || 0})</h2>
        </div>
        {!role.matches || role.matches.length === 0 ? (
          <div className="card p-6 text-center text-sm text-gray-400">No matches yet. Click Rescore to evaluate existing candidates.</div>
        ) : (
          <div className="card divide-y divide-gray-100">
            {role.matches.map(m => (
              <div key={m.id} className="flex items-center gap-4 px-4 py-3 hover:bg-gray-50">
                <div className="w-10 h-10 rounded-full bg-amber-50 border border-amber-100 flex items-center justify-center text-amber-700 font-semibold text-sm tabular-nums flex-shrink-0">
                  {m.match_score}
                </div>
                <div className="flex-1 min-w-0">
                  <Link to={`/talent/candidates/${m.candidate_id}`} className="text-sm font-medium text-gray-900 hover:text-amber-700">{m.candidate_name}</Link>
                  <div className="text-xs text-gray-500 truncate">{m.current_role}{m.current_company ? ` · ${m.current_company}` : ''}</div>
                </div>
                <span className="badge badge-gray text-[10px]">{m.status}</span>
              </div>
            ))}
          </div>
        )}
      </div>

      {saving && <div className="text-xs text-gray-400 text-right">Saving...</div>}
    </div>
  );
}
