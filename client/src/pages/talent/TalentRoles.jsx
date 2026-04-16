import { useState, useEffect } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../../utils/api';
import TagInput from '../../components/TagInput';
import { useToast } from '../../components/Toast';

const STATUS_COLORS = { open: 'badge-green', paused: 'badge-amber', filled: 'badge-blue', closed: 'badge-gray' };
const PRIORITY_COLORS = { urgent: 'badge-red', normal: 'badge-gray', low: 'badge-gray' };
const BAND_LABEL = { A: 'A · Cofounder/Founding', B: 'B · First-5', C: 'C · Domain Expert' };

export default function TalentRoles() {
  const [roles, setRoles] = useState([]);
  const [companies, setCompanies] = useState([]);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState({ status: 'all', band: '', priority: '', search: '' });
  const [selected, setSelected] = useState(new Set());
  const [showNew, setShowNew] = useState(false);
  const { toast } = useToast();

  const emptyDraft = {
    portfolio_company_id: '', title: '', band: 'A', priority: 'normal', status: 'open',
    location_pref: '', remote_ok: 1, min_years_experience: '', max_years_experience: '',
    comp_low: '', comp_high: '', equity_low: '', equity_high: '', jd_content: '', notes: '',
    stack_requirements: [], domain_requirements: [], must_haves: [], nice_to_haves: [],
  };
  const [draft, setDraft] = useState(emptyDraft);

  useEffect(() => { load(); }, [filter.status, filter.band, filter.priority]);
  useEffect(() => { api.getTalentPortfolio().then(setCompanies).catch(() => {}); }, []);

  async function load() {
    setLoading(true);
    try {
      const params = {};
      if (filter.status && filter.status !== 'all') params.status = filter.status;
      if (filter.band) params.band = filter.band;
      if (filter.priority) params.priority = filter.priority;
      if (filter.search) params.search = filter.search;
      const rows = await api.getTalentRoles(params);
      setRoles(rows);
    } catch (err) {
      toast({ message: err.message, tone: 'error' });
    } finally {
      setLoading(false);
    }
  }

  async function createRole() {
    if (!draft.title.trim() || !draft.portfolio_company_id) {
      toast({ message: 'Title and company are required', tone: 'error' });
      return;
    }
    try {
      await api.createTalentRole(draft);
      setDraft(emptyDraft);
      setShowNew(false);
      load();
      toast({ message: 'Role created' });
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
      await api.bulkDeleteTalentRoles(ids);
      setSelected(new Set());
      load();
      toast({
        message: `${ids.length} role${ids.length === 1 ? '' : 's'} deleted`,
        actionLabel: 'Undo',
        onAction: async () => { await api.restoreTalentTrash('role', ids); load(); },
      });
    } catch (err) {
      toast({ message: err.message, tone: 'error' });
    }
  }

  async function bulkUpdateStatus(status) {
    const ids = Array.from(selected);
    if (!ids.length) return;
    try {
      await api.bulkUpdateTalentRoles(ids, { status });
      setSelected(new Set());
      load();
      toast({ message: 'Updated' });
    } catch (err) {
      toast({ message: err.message, tone: 'error' });
    }
  }

  return (
    <div className="space-y-5">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold text-gray-900 tracking-tight">Roles</h1>
          <p className="text-sm text-gray-500 mt-1">Open roles across portfolio companies.</p>
        </div>
        <button onClick={() => setShowNew(s => !s)} className="btn-primary bg-amber-600 hover:bg-amber-700 border-0">
          + New role
        </button>
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <input
          className="input max-w-xs"
          placeholder="Search roles..."
          value={filter.search}
          onChange={e => setFilter({ ...filter, search: e.target.value })}
          onKeyDown={e => e.key === 'Enter' && load()}
        />
        <select className="select" value={filter.status} onChange={e => setFilter({ ...filter, status: e.target.value })}>
          <option value="all">All status</option>
          <option value="open">Open</option>
          <option value="paused">Paused</option>
          <option value="filled">Filled</option>
          <option value="closed">Closed</option>
        </select>
        <select className="select" value={filter.band} onChange={e => setFilter({ ...filter, band: e.target.value })}>
          <option value="">All bands</option>
          <option value="A">A — Cofounder/Founding</option>
          <option value="B">B — First-5</option>
          <option value="C">C — Domain Expert</option>
        </select>
        <select className="select" value={filter.priority} onChange={e => setFilter({ ...filter, priority: e.target.value })}>
          <option value="">All priority</option>
          <option value="urgent">Urgent</option>
          <option value="normal">Normal</option>
          <option value="low">Low</option>
        </select>
      </div>

      {showNew && (
        <div className="card p-5 space-y-4">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            <select className="select" value={draft.portfolio_company_id} onChange={e => setDraft({ ...draft, portfolio_company_id: e.target.value })}>
              <option value="">Portfolio company *</option>
              {companies.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
            </select>
            <input className="input" placeholder="Title * (e.g. Founding Engineer)" value={draft.title} onChange={e => setDraft({ ...draft, title: e.target.value })} />
            <select className="select" value={draft.band} onChange={e => setDraft({ ...draft, band: e.target.value })}>
              <option value="A">A — Cofounder / Founding Eng</option>
              <option value="B">B — First-5 Hire</option>
              <option value="C">C — Domain Expert</option>
            </select>
            <select className="select" value={draft.priority} onChange={e => setDraft({ ...draft, priority: e.target.value })}>
              <option value="urgent">Urgent</option>
              <option value="normal">Normal</option>
              <option value="low">Low</option>
            </select>
            <input className="input" placeholder="Location preference" value={draft.location_pref} onChange={e => setDraft({ ...draft, location_pref: e.target.value })} />
            <label className="flex items-center gap-2 text-sm">
              <input type="checkbox" checked={!!draft.remote_ok} onChange={e => setDraft({ ...draft, remote_ok: e.target.checked ? 1 : 0 })} />
              Remote OK
            </label>
            <input className="input" placeholder="Comp low ($)" type="number" value={draft.comp_low} onChange={e => setDraft({ ...draft, comp_low: e.target.value })} />
            <input className="input" placeholder="Comp high ($)" type="number" value={draft.comp_high} onChange={e => setDraft({ ...draft, comp_high: e.target.value })} />
            <input className="input" placeholder="Equity low (%)" type="number" step="0.01" value={draft.equity_low} onChange={e => setDraft({ ...draft, equity_low: e.target.value })} />
            <input className="input" placeholder="Equity high (%)" type="number" step="0.01" value={draft.equity_high} onChange={e => setDraft({ ...draft, equity_high: e.target.value })} />
          </div>
          <div>
            <label className="label">Stack requirements</label>
            <TagInput tags={draft.stack_requirements} onChange={v => setDraft({ ...draft, stack_requirements: v })} placeholder="e.g. Python, Rust, PyTorch" accent="amber" />
          </div>
          <div>
            <label className="label">Domain requirements</label>
            <TagInput tags={draft.domain_requirements} onChange={v => setDraft({ ...draft, domain_requirements: v })} placeholder="e.g. Healthtech, DevTools" accent="amber" />
          </div>
          <div>
            <label className="label">Must-haves</label>
            <TagInput tags={draft.must_haves} onChange={v => setDraft({ ...draft, must_haves: v })} placeholder="Non-negotiable requirements" accent="amber" />
          </div>
          <div>
            <label className="label">Nice-to-haves</label>
            <TagInput tags={draft.nice_to_haves} onChange={v => setDraft({ ...draft, nice_to_haves: v })} placeholder="Bonus signals" accent="amber" />
          </div>
          <div>
            <label className="label">Job description</label>
            <textarea className="input w-full font-mono text-xs" rows={6} placeholder="Markdown or plain text JD..." value={draft.jd_content} onChange={e => setDraft({ ...draft, jd_content: e.target.value })} />
          </div>
          <div className="flex gap-2">
            <button onClick={createRole} className="btn-primary bg-amber-600 hover:bg-amber-700 border-0">Create role</button>
            <button onClick={() => { setShowNew(false); setDraft(emptyDraft); }} className="btn-ghost">Cancel</button>
          </div>
        </div>
      )}

      {selected.size > 0 && (
        <div className="flex items-center justify-between bg-amber-50 border border-amber-200 rounded-lg px-4 py-2">
          <span className="text-sm text-amber-900">{selected.size} selected</span>
          <div className="flex gap-2">
            <button onClick={() => bulkUpdateStatus('paused')} className="btn-ghost text-xs">Pause</button>
            <button onClick={() => bulkUpdateStatus('closed')} className="btn-ghost text-xs">Close</button>
            <button onClick={() => setSelected(new Set())} className="btn-ghost text-xs">Clear</button>
            <button onClick={bulkDelete} className="btn-danger text-xs">Delete</button>
          </div>
        </div>
      )}

      {loading ? (
        <div className="text-sm text-gray-400">Loading...</div>
      ) : roles.length === 0 ? (
        <div className="card p-8 text-center text-sm text-gray-400">No roles yet.</div>
      ) : (
        <div className="card overflow-hidden">
          <table className="w-full text-sm">
            <thead className="bg-gray-50 border-b border-gray-200">
              <tr>
                <th className="px-3 py-2 w-8"></th>
                <th className="px-3 py-2 text-left font-medium text-gray-600">Role</th>
                <th className="px-3 py-2 text-left font-medium text-gray-600">Company</th>
                <th className="px-3 py-2 text-left font-medium text-gray-600">Band</th>
                <th className="px-3 py-2 text-left font-medium text-gray-600">Status</th>
                <th className="px-3 py-2 text-left font-medium text-gray-600">Priority</th>
                <th className="px-3 py-2 text-right font-medium text-gray-600">Matches</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {roles.map(r => (
                <tr key={r.id} className="hover:bg-gray-50">
                  <td className="px-3 py-2">
                    <input type="checkbox" checked={selected.has(r.id)} onChange={() => toggleSelect(r.id)} />
                  </td>
                  <td className="px-3 py-2">
                    <Link to={`/talent/roles/${r.id}`} className="font-medium text-gray-900 hover:text-amber-700">{r.title}</Link>
                    {r.location_pref && <div className="text-xs text-gray-400">{r.location_pref}{r.remote_ok ? ' · Remote OK' : ''}</div>}
                  </td>
                  <td className="px-3 py-2 text-gray-600">{r.company_name || '—'}</td>
                  <td className="px-3 py-2 text-gray-600 text-xs">{BAND_LABEL[r.band] || r.band || '—'}</td>
                  <td className="px-3 py-2"><span className={`badge ${STATUS_COLORS[r.status] || 'badge-gray'}`}>{r.status}</span></td>
                  <td className="px-3 py-2"><span className={`badge ${PRIORITY_COLORS[r.priority] || 'badge-gray'}`}>{r.priority}</span></td>
                  <td className="px-3 py-2 text-right tabular-nums text-gray-600">{r.pending_matches || 0} / {(r.pending_matches || 0) + (r.active_matches || 0)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
