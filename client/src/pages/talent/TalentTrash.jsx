import { useState, useEffect } from 'react';
import { api } from '../../utils/api';
import { useToast } from '../../components/Toast';

const TYPES = [
  { key: 'companies', type: 'company', label: 'Companies' },
  { key: 'roles', type: 'role', label: 'Roles' },
  { key: 'candidates', type: 'candidate', label: 'Candidates' },
  { key: 'matches', type: 'match', label: 'Matches' },
];

export default function TalentTrash() {
  const [data, setData] = useState({ companies: [], roles: [], candidates: [], matches: [] });
  const [loading, setLoading] = useState(true);
  const [selected, setSelected] = useState({});
  const { toast } = useToast();

  async function load() {
    setLoading(true);
    try {
      const d = await api.getTalentTrash();
      setData(d);
    } catch (err) {
      toast({ message: err.message, tone: 'error' });
    } finally {
      setLoading(false);
    }
  }
  useEffect(() => { load(); }, []);

  function toggle(type, id) {
    setSelected(s => {
      const cur = new Set(s[type] || []);
      cur.has(id) ? cur.delete(id) : cur.add(id);
      return { ...s, [type]: cur };
    });
  }

  async function restore(type, key) {
    const ids = Array.from(selected[type] || []);
    if (!ids.length) return;
    try {
      await api.restoreTalentTrash(type, ids);
      setSelected(s => ({ ...s, [type]: new Set() }));
      load();
      toast({ message: `${ids.length} restored` });
    } catch (err) {
      toast({ message: err.message, tone: 'error' });
    }
  }

  async function purge(type, key) {
    const ids = Array.from(selected[type] || []);
    if (!ids.length) return;
    if (!confirm(`Permanently delete ${ids.length} item${ids.length === 1 ? '' : 's'}? This cannot be undone.`)) return;
    try {
      await api.purgeTalentTrash(type, ids);
      setSelected(s => ({ ...s, [type]: new Set() }));
      load();
      toast({ message: 'Purged' });
    } catch (err) {
      toast({ message: err.message, tone: 'error' });
    }
  }

  async function emptyAll() {
    if (!confirm('Empty entire trash? Everything will be permanently deleted.')) return;
    try {
      const r = await api.emptyTalentTrash();
      toast({ message: `${r.count} items purged` });
      load();
    } catch (err) {
      toast({ message: err.message, tone: 'error' });
    }
  }

  function label(item, type) {
    if (type === 'company') return item.name;
    if (type === 'role') return item.title;
    if (type === 'candidate') return `${item.name}${item.current_company ? ` · ${item.current_company}` : ''}`;
    if (type === 'match') return `Match #${item.id} (candidate ${item.candidate_id} → role ${item.role_id})`;
    return '';
  }

  if (loading) return <div className="text-sm text-gray-400">Loading...</div>;

  const totalCount = Object.values(data).reduce((n, arr) => n + arr.length, 0);

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold text-gray-900 tracking-tight">Trash</h1>
          <p className="text-sm text-gray-500 mt-1">Soft-deleted items. Restore or purge permanently.</p>
        </div>
        {totalCount > 0 && (
          <button onClick={emptyAll} className="btn-danger text-xs">Empty trash</button>
        )}
      </div>

      {totalCount === 0 && (
        <div className="card p-8 text-center text-sm text-gray-400">Trash is empty.</div>
      )}

      {TYPES.map(t => {
        const items = data[t.key] || [];
        if (items.length === 0) return null;
        const sel = selected[t.type] || new Set();
        return (
          <section key={t.key} className="card">
            <div className="flex items-center justify-between px-4 py-2 border-b border-gray-100 bg-gray-50">
              <h2 className="text-sm font-semibold text-gray-900">{t.label} <span className="text-xs text-gray-500 ml-1">({items.length})</span></h2>
              {sel.size > 0 && (
                <div className="flex gap-2">
                  <button onClick={() => restore(t.type, t.key)} className="btn-ghost text-xs">Restore {sel.size}</button>
                  <button onClick={() => purge(t.type, t.key)} className="btn-danger text-xs">Purge {sel.size}</button>
                </div>
              )}
            </div>
            <div className="divide-y divide-gray-100">
              {items.map(item => (
                <label key={item.id} className="flex items-center gap-3 px-4 py-2 hover:bg-gray-50 cursor-pointer">
                  <input type="checkbox" checked={sel.has(item.id)} onChange={() => toggle(t.type, item.id)} />
                  <div className="flex-1 min-w-0 text-sm text-gray-700 truncate">{label(item, t.type)}</div>
                  <div className="text-xs text-gray-400 flex-shrink-0">{new Date(item.deleted_at).toLocaleDateString()}</div>
                </label>
              ))}
            </div>
          </section>
        );
      })}
    </div>
  );
}
