import { useState, useEffect } from 'react';
import { useParams, Link, useNavigate } from 'react-router-dom';
import { api } from '../../utils/api';
import { useToast } from '../../components/Toast';

const EDITABLE_FIELDS = [
  { key: 'name', label: 'Name', type: 'text' },
  { key: 'one_liner', label: 'One-liner', type: 'text' },
  { key: 'website_url', label: 'Website', type: 'text' },
  { key: 'stage', label: 'Stage', type: 'text' },
  { key: 'sector', label: 'Sector', type: 'text' },
  { key: 'hq_location', label: 'HQ', type: 'text' },
  { key: 'remote_policy', label: 'Remote policy', type: 'text' },
  { key: 'founder_name', label: 'Founder', type: 'text' },
  { key: 'founder_email', label: 'Founder email', type: 'text' },
  { key: 'status', label: 'Status', type: 'select', options: ['active', 'paused', 'archived'] },
];

export default function TalentPortfolioDetail() {
  const { id } = useParams();
  const navigate = useNavigate();
  const [company, setCompany] = useState(null);
  const [editing, setEditing] = useState({});
  const { toast } = useToast();

  async function load() {
    try {
      const c = await api.getTalentCompany(id);
      setCompany(c);
    } catch (err) {
      toast({ message: err.message, tone: 'error' });
    }
  }
  useEffect(() => { load(); }, [id]);

  async function saveField(key, value) {
    try {
      const updated = await api.updateTalentCompany(id, { [key]: value });
      setCompany(c => ({ ...c, ...updated }));
      setEditing(e => ({ ...e, [key]: false }));
    } catch (err) {
      toast({ message: err.message, tone: 'error' });
    }
  }

  async function remove() {
    if (!confirm('Delete this company? Its roles will also be moved to trash.')) return;
    try {
      await api.deleteTalentCompany(id);
      toast({
        message: 'Company deleted',
        actionLabel: 'Undo',
        onAction: async () => { await api.restoreTalentTrash('company', [parseInt(id)]); navigate(`/talent/portfolio/${id}`); },
      });
      navigate('/talent/portfolio');
    } catch (err) {
      toast({ message: err.message, tone: 'error' });
    }
  }

  if (!company) return <div className="text-sm text-gray-400">Loading...</div>;

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <Link to="/talent/portfolio" className="text-sm text-gray-500 hover:text-gray-700">← Portfolio</Link>
        <button onClick={remove} className="btn-danger text-xs">Delete</button>
      </div>

      <div>
        <h1 className="text-2xl font-semibold text-gray-900 tracking-tight">{company.name}</h1>
        {company.one_liner && <p className="text-sm text-gray-500 mt-1">{company.one_liner}</p>}
      </div>

      <div className="card p-5">
        <h2 className="text-sm font-semibold text-gray-900 mb-3">Company details</h2>
        <dl className="grid grid-cols-1 md:grid-cols-2 gap-x-6 gap-y-3">
          {EDITABLE_FIELDS.map(f => (
            <div key={f.key} className="flex items-center gap-3">
              <dt className="text-xs text-gray-500 w-28 flex-shrink-0">{f.label}</dt>
              <dd className="flex-1 min-w-0">
                {editing[f.key] ? (
                  f.type === 'select' ? (
                    <select
                      autoFocus
                      defaultValue={company[f.key] || f.options[0]}
                      onBlur={e => saveField(f.key, e.target.value)}
                      className="select w-full text-sm"
                    >
                      {f.options.map(o => <option key={o} value={o}>{o}</option>)}
                    </select>
                  ) : (
                    <input
                      autoFocus
                      defaultValue={company[f.key] || ''}
                      onBlur={e => saveField(f.key, e.target.value)}
                      onKeyDown={e => { if (e.key === 'Enter') e.target.blur(); if (e.key === 'Escape') setEditing(ed => ({ ...ed, [f.key]: false })); }}
                      className="input w-full text-sm"
                    />
                  )
                ) : (
                  <button onClick={() => setEditing(e => ({ ...e, [f.key]: true }))} className="text-sm text-gray-800 hover:bg-gray-50 px-2 py-0.5 rounded w-full text-left">
                    {company[f.key] || <span className="text-gray-400">—</span>}
                  </button>
                )}
              </dd>
            </div>
          ))}
        </dl>
      </div>

      <div className="card p-5">
        <h2 className="text-sm font-semibold text-gray-900 mb-3">Notes</h2>
        <textarea
          className="input w-full font-mono text-xs"
          rows={5}
          defaultValue={company.notes || ''}
          onBlur={e => saveField('notes', e.target.value)}
          placeholder="Anything we know about the hiring process, stage of search, preferences..."
        />
      </div>

      <div>
        <div className="flex items-center justify-between mb-3">
          <h2 className="text-sm font-semibold text-gray-900">Roles</h2>
          <Link to="/talent/roles" className="text-xs text-amber-700 hover:text-amber-800">Manage all →</Link>
        </div>
        {(!company.roles || company.roles.length === 0) ? (
          <div className="card p-6 text-center text-sm text-gray-400">No roles yet for this company.</div>
        ) : (
          <div className="card divide-y divide-gray-100">
            {company.roles.map(r => (
              <Link key={r.id} to={`/talent/roles/${r.id}`} className="flex items-center justify-between px-4 py-3 hover:bg-gray-50">
                <div>
                  <div className="text-sm font-medium text-gray-900">{r.title}</div>
                  <div className="text-xs text-gray-500">Band {r.band} · {r.status}{r.priority === 'urgent' ? ' · URGENT' : ''}</div>
                </div>
              </Link>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
