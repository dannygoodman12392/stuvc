import { useState, useEffect } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../../utils/api';
import { useToast } from '../../components/Toast';
import { PageHeader } from '../../components/ui';

const FUNCTIONS = [
  ['engineering', 'Engineering'],
  ['gtm', 'Go-to-Market (Sales / Marketing / Growth)'],
  ['success', 'Customer Success'],
  ['product', 'Product'],
  ['design', 'Design'],
  ['operations', 'Operations'],
  ['finance', 'Finance'],
  ['generalist', 'Generalist / Business'],
];
const FN_LABEL = Object.fromEntries(FUNCTIONS);
const BANDS = [['A', 'A — Founding / Leader'], ['B', 'B — First-5 / Senior'], ['C', 'C — Domain expert']];

export default function TalentHome() {
  const [companies, setCompanies] = useState([]);
  const [rolesByCo, setRolesByCo] = useState({});
  const [loading, setLoading] = useState(true);
  const [addingCo, setAddingCo] = useState(false);
  const [coDraft, setCoDraft] = useState({ name: '', one_liner: '', sector: '' });
  const [addRoleFor, setAddRoleFor] = useState(null);
  const [roleDraft, setRoleDraft] = useState({ title: '', role_function: 'engineering', band: 'A', location_pref: 'Chicago' });
  const [sourcing, setSourcing] = useState(null);
  const { toast } = useToast();

  async function load() {
    setLoading(true);
    try {
      const [co, roles] = await Promise.all([api.getTalentPortfolio(), api.getTalentRoles()]);
      setCompanies(Array.isArray(co) ? co : []);
      const grouped = {};
      for (const r of (Array.isArray(roles) ? roles : [])) (grouped[r.portfolio_company_id] ||= []).push(r);
      setRolesByCo(grouped);
    } catch (e) { toast({ message: e.message, tone: 'error' }); }
    finally { setLoading(false); }
  }
  useEffect(() => { load(); /* eslint-disable-next-line */ }, []);

  async function createCompany() {
    if (!coDraft.name.trim()) { toast({ message: 'Company name required', tone: 'error' }); return; }
    try {
      await api.createTalentCompany(coDraft);
      setCoDraft({ name: '', one_liner: '', sector: '' }); setAddingCo(false);
      await load();
    } catch (e) { toast({ message: e.message, tone: 'error' }); }
  }

  async function createRole(companyId) {
    if (!roleDraft.title.trim()) { toast({ message: 'Role title required', tone: 'error' }); return; }
    try {
      await api.createTalentRole({ portfolio_company_id: companyId, status: 'open', ...roleDraft });
      setRoleDraft({ title: '', role_function: 'engineering', band: 'A', location_pref: 'Chicago' });
      setAddRoleFor(null);
      await load();
    } catch (e) { toast({ message: e.message, tone: 'error' }); }
  }

  async function sourceRole(role) {
    setSourcing(role.id);
    try {
      await api.triggerTalentSourcing({ role_id: role.id });
      toast({ message: `Sourcing ${FN_LABEL[role.role_function] || 'candidates'} for ${role.title} — check matches in a few minutes.` });
    } catch (e) { toast({ message: e.message, tone: 'error' }); }
    finally { setTimeout(() => setSourcing(null), 1500); }
  }

  async function deleteRole(role) {
    if (!confirm(`Delete the "${role.title}" role? It moves to Trash and can be restored.`)) return;
    try {
      await api.deleteTalentRole(role.id);
      toast({ message: `Deleted "${role.title}"` });
      load();
    } catch (e) { toast({ message: e.message, tone: 'error' }); }
  }

  if (loading) return <div className="text-center py-12 text-gray-500 text-sm">Loading…</div>;

  return (
    <div className="max-w-3xl mx-auto space-y-5">
      <PageHeader
        title="Talent"
        subtitle="Add a company → add a role → source the best local candidates for it."
        actions={
          <>
            <Link to="/talent/matches" className="btn-secondary text-sm">View matches</Link>
            <button onClick={() => setAddingCo(v => !v)} className="btn-primary text-sm">Add company</button>
          </>
        }
      />

      {/* Add company */}
      {addingCo && (
        <div className="card p-4 space-y-2">
          <input className="input w-full" placeholder="Company name *" value={coDraft.name} onChange={e => setCoDraft({ ...coDraft, name: e.target.value })} />
          <input className="input w-full" placeholder="What does it do? (one-liner)" value={coDraft.one_liner} onChange={e => setCoDraft({ ...coDraft, one_liner: e.target.value })} />
          <input className="input w-full" placeholder="Sector (optional)" value={coDraft.sector} onChange={e => setCoDraft({ ...coDraft, sector: e.target.value })} />
          <div className="flex gap-2">
            <button onClick={createCompany} className="btn-primary text-xs">Create company</button>
            <button onClick={() => setAddingCo(false)} className="btn-ghost text-xs">Cancel</button>
          </div>
        </div>
      )}

      {companies.length === 0 && !addingCo && (
        <div className="card p-8 text-center text-sm text-gray-400">
          No companies yet. Click <span className="font-medium text-gray-600">+ Add company</span> to start.
        </div>
      )}

      {/* Companies → roles */}
      {companies.map(c => {
        const roles = rolesByCo[c.id] || [];
        return (
          <div key={c.id} className="card overflow-hidden">
            <div className="px-4 py-3 border-b border-gray-100 flex items-start justify-between gap-3">
              <div className="min-w-0">
                <Link to={`/talent/portfolio/${c.id}`} className="text-sm font-semibold text-gray-900 hover:text-amber-700">{c.name}</Link>
                {c.one_liner && <p className="text-xs text-gray-500 mt-0.5">{c.one_liner}</p>}
              </div>
              <button onClick={() => setAddRoleFor(addRoleFor === c.id ? null : c.id)} className="text-xs font-medium text-amber-700 hover:text-amber-800 flex-shrink-0">+ Add role</button>
            </div>

            {/* Add role inline */}
            {addRoleFor === c.id && (
              <div className="px-4 py-3 bg-gray-50 border-b border-gray-100 space-y-2">
                <input className="input w-full" placeholder="Role title (e.g. Head of Customer Success) *" value={roleDraft.title} onChange={e => setRoleDraft({ ...roleDraft, title: e.target.value })} />
                <div className="flex gap-2 flex-wrap">
                  <select className="select flex-1 min-w-[180px]" value={roleDraft.role_function} onChange={e => setRoleDraft({ ...roleDraft, role_function: e.target.value })}>
                    {FUNCTIONS.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
                  </select>
                  <select className="select" value={roleDraft.band} onChange={e => setRoleDraft({ ...roleDraft, band: e.target.value })}>
                    {BANDS.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
                  </select>
                  <input className="input w-28" placeholder="Location" value={roleDraft.location_pref} onChange={e => setRoleDraft({ ...roleDraft, location_pref: e.target.value })} />
                </div>
                <div className="flex gap-2">
                  <button onClick={() => createRole(c.id)} className="btn-primary text-xs">Create role</button>
                  <button onClick={() => setAddRoleFor(null)} className="btn-ghost text-xs">Cancel</button>
                </div>
              </div>
            )}

            {/* Roles */}
            {roles.length === 0 ? (
              <div className="px-4 py-3 text-xs text-gray-400">No roles yet — add one to start sourcing.</div>
            ) : (
              <div className="divide-y divide-gray-100">
                {roles.map(r => (
                  <div key={r.id} className="px-4 py-2.5 flex items-center justify-between gap-3">
                    <div className="min-w-0">
                      <Link to={`/talent/roles/${r.id}`} className="text-sm font-medium text-gray-900 hover:text-amber-700">{r.title}</Link>
                      <div className="text-[11px] text-gray-500">
                        {FN_LABEL[r.role_function] || 'Engineering'} · Band {r.band || 'A'}{r.location_pref ? ` · ${r.location_pref}` : ''}
                      </div>
                    </div>
                    <div className="flex items-center gap-3 flex-shrink-0">
                      <Link to={`/talent/matches?role=${r.id}`} className="text-[11px] text-gray-500 hover:text-amber-700">
                        {r.pending_matches > 0 ? `${r.pending_matches} to review` : 'matches'}
                      </Link>
                      <Link to={`/talent/roles/${r.id}`} className="text-[11px] text-gray-500 hover:text-amber-700">Edit</Link>
                      <button onClick={() => sourceRole(r)} disabled={sourcing === r.id} className="btn-primary text-xs px-3 py-1 disabled:opacity-50">
                        {sourcing === r.id ? 'Starting…' : 'Source for this role'}
                      </button>
                      <button onClick={() => deleteRole(r)} title="Delete role" className="text-gray-300 hover:text-red-500 text-sm leading-none px-1">✕</button>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}
