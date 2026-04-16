import { useState, useEffect } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../../utils/api';
import { useToast } from '../../components/Toast';

export default function TalentPortfolio() {
  const [companies, setCompanies] = useState([]);
  const [loading, setLoading] = useState(true);
  const [selected, setSelected] = useState(new Set());
  const [showNew, setShowNew] = useState(false);
  const [draft, setDraft] = useState({ name: '', website_url: '', stage: '', sector: '', hq_location: '', one_liner: '', notes: '' });
  const { toast } = useToast();

  useEffect(() => { load(); }, []);

  async function load() {
    setLoading(true);
    try {
      const rows = await api.getTalentPortfolio();
      setCompanies(rows);
    } catch (err) {
      toast({ message: err.message, tone: 'error' });
    } finally {
      setLoading(false);
    }
  }

  async function createCompany() {
    if (!draft.name.trim()) return;
    try {
      await api.createTalentCompany(draft);
      setDraft({ name: '', website_url: '', stage: '', sector: '', hq_location: '', one_liner: '', notes: '' });
      setShowNew(false);
      load();
      toast({ message: 'Company added' });
    } catch (err) {
      toast({ message: err.message, tone: 'error' });
    }
  }

  function toggleSelect(id) {
    setSelected(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  }

  function toggleAll() {
    if (selected.size === companies.length) setSelected(new Set());
    else setSelected(new Set(companies.map(c => c.id)));
  }

  async function bulkDelete() {
    const ids = Array.from(selected);
    if (ids.length === 0) return;
    const prev = companies;
    setCompanies(companies.filter(c => !selected.has(c.id)));
    setSelected(new Set());
    try {
      await api.bulkDeleteTalentCompanies(ids);
      toast({
        message: `${ids.length} compan${ids.length === 1 ? 'y' : 'ies'} deleted`,
        actionLabel: 'Undo',
        onAction: async () => {
          await api.restoreTalentTrash('company', ids);
          load();
        },
      });
    } catch (err) {
      setCompanies(prev);
      toast({ message: err.message, tone: 'error' });
    }
  }

  return (
    <div className="space-y-5">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold text-gray-900 tracking-tight">Portfolio companies</h1>
          <p className="text-sm text-gray-500 mt-1">Companies you're helping hire for.</p>
        </div>
        <button onClick={() => setShowNew(s => !s)} className="btn-primary bg-amber-600 hover:bg-amber-700 border-0">
          + Add company
        </button>
      </div>

      {showNew && (
        <div className="card p-4 space-y-3">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            <input className="input" placeholder="Company name *" value={draft.name} onChange={e => setDraft({ ...draft, name: e.target.value })} />
            <input className="input" placeholder="Website" value={draft.website_url} onChange={e => setDraft({ ...draft, website_url: e.target.value })} />
            <input className="input" placeholder="Stage (seed, Series A, etc)" value={draft.stage} onChange={e => setDraft({ ...draft, stage: e.target.value })} />
            <input className="input" placeholder="Sector" value={draft.sector} onChange={e => setDraft({ ...draft, sector: e.target.value })} />
            <input className="input" placeholder="HQ location" value={draft.hq_location} onChange={e => setDraft({ ...draft, hq_location: e.target.value })} />
            <input className="input" placeholder="One-liner" value={draft.one_liner} onChange={e => setDraft({ ...draft, one_liner: e.target.value })} />
          </div>
          <textarea className="input w-full" rows={2} placeholder="Notes" value={draft.notes} onChange={e => setDraft({ ...draft, notes: e.target.value })} />
          <div className="flex gap-2">
            <button onClick={createCompany} className="btn-primary bg-amber-600 hover:bg-amber-700 border-0">Create</button>
            <button onClick={() => setShowNew(false)} className="btn-ghost">Cancel</button>
          </div>
        </div>
      )}

      {selected.size > 0 && (
        <div className="flex items-center justify-between bg-amber-50 border border-amber-200 rounded-lg px-4 py-2">
          <span className="text-sm text-amber-900">{selected.size} selected</span>
          <div className="flex gap-2">
            <button onClick={() => setSelected(new Set())} className="btn-ghost text-xs">Clear</button>
            <button onClick={bulkDelete} className="btn-danger text-xs">Delete</button>
          </div>
        </div>
      )}

      {loading ? (
        <div className="text-sm text-gray-400">Loading...</div>
      ) : companies.length === 0 ? (
        <div className="card p-8 text-center text-sm text-gray-400">
          No portfolio companies yet. Add one to start posting roles.
        </div>
      ) : (
        <div className="card overflow-hidden">
          <table className="w-full text-sm">
            <thead className="bg-gray-50 border-b border-gray-200">
              <tr>
                <th className="px-3 py-2 w-8">
                  <input type="checkbox" checked={selected.size === companies.length && companies.length > 0} onChange={toggleAll} />
                </th>
                <th className="px-3 py-2 text-left font-medium text-gray-600">Name</th>
                <th className="px-3 py-2 text-left font-medium text-gray-600">Stage</th>
                <th className="px-3 py-2 text-left font-medium text-gray-600">Sector</th>
                <th className="px-3 py-2 text-left font-medium text-gray-600">HQ</th>
                <th className="px-3 py-2 text-right font-medium text-gray-600">Roles</th>
                <th className="px-3 py-2 text-right font-medium text-gray-600">Matches</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {companies.map(c => (
                <tr key={c.id} className="hover:bg-gray-50">
                  <td className="px-3 py-2">
                    <input type="checkbox" checked={selected.has(c.id)} onChange={() => toggleSelect(c.id)} />
                  </td>
                  <td className="px-3 py-2">
                    <Link to={`/talent/portfolio/${c.id}`} className="font-medium text-gray-900 hover:text-amber-700">
                      {c.name}
                    </Link>
                    {c.website_url && <div className="text-xs text-gray-400 truncate max-w-[220px]">{c.website_url}</div>}
                  </td>
                  <td className="px-3 py-2 text-gray-600">{c.stage || '—'}</td>
                  <td className="px-3 py-2 text-gray-600">{c.sector || '—'}</td>
                  <td className="px-3 py-2 text-gray-600">{c.hq_location || '—'}</td>
                  <td className="px-3 py-2 text-right text-gray-600 tabular-nums">{c.open_roles || 0} / {c.total_roles || 0}</td>
                  <td className="px-3 py-2 text-right text-gray-600 tabular-nums">{c.pending_matches || 0}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
