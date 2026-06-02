import { useState, useEffect, useRef } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../utils/api';
import { useToast } from '../components/Toast';

const GROUP_META = {
  book: { title: 'Touches Your Pipeline', accent: 'text-violet-700', dot: 'bg-violet-500' },
  thesis: { title: 'On Your Thesis', accent: 'text-amber-700', dot: 'bg-amber-500' },
  general: { title: 'Worth Knowing', accent: 'text-gray-600', dot: 'bg-gray-300' },
};

function Item({ it, onDismiss }) {
  return (
    <div className="card p-4">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="text-sm font-semibold text-gray-900">{it.source_name || 'Newsletter'}</span>
            {it.received_at && (
              <span className="text-[10px] text-gray-400">{new Date(it.received_at).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}</span>
            )}
            {it.relevance_score >= 65 && (
              <span className="text-[10px] font-semibold px-1.5 py-0.5 rounded-full bg-violet-50 text-violet-700 border border-violet-200">
                Relevant
              </span>
            )}
          </div>
          {it.subject && <div className="text-xs text-gray-400 mt-0.5 truncate">{it.subject}</div>}
        </div>
        <button onClick={() => onDismiss(it.id)} className="text-gray-300 hover:text-gray-500 text-xs flex-shrink-0" title="Dismiss">✕</button>
      </div>

      {it.summary && <p className="text-sm text-gray-800 mt-2">{it.summary}</p>}

      {it.key_points?.length > 0 && (
        <ul className="mt-2 space-y-1">
          {it.key_points.map((p, i) => (
            <li key={i} className="text-xs text-gray-600 flex gap-2"><span className="text-gray-300">•</span><span>{p}</span></li>
          ))}
        </ul>
      )}

      <div className="flex items-center justify-between mt-3">
        {it.relevance_reason && <span className="text-[11px] text-gray-400">{it.relevance_reason}</span>}
        {it.url && (
          <a href={it.url} target="_blank" rel="noopener" className="text-xs font-medium text-amber-700 hover:text-amber-800 flex-shrink-0">
            Read full issue →
          </a>
        )}
      </div>
    </div>
  );
}

export default function Brief() {
  const [data, setData] = useState(null);
  const [status, setStatus] = useState(null);
  const [loading, setLoading] = useState(true);
  const [syncing, setSyncing] = useState(false);
  const pollRef = useRef(null);
  const { toast } = useToast();

  async function load() {
    try {
      const [brief, st] = await Promise.all([api.getNewsletterBrief(), api.getNewsletterStatus()]);
      setData(brief);
      setStatus(st);
    } catch (err) {
      toast({ message: err.message, tone: 'error' });
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { load(); return () => clearInterval(pollRef.current); }, []);

  async function sync() {
    setSyncing(true);
    try {
      const r = await api.syncNewsletter();
      if (r.started === false && !r.running) { setSyncing(false); return; }
      toast({ message: 'Pulling your newsletters…', duration: 2000 });
      // Poll status until the background sync finishes, then reload the brief.
      pollRef.current = setInterval(async () => {
        try {
          const st = await api.getNewsletterStatus();
          setStatus(st);
          if (!st.running) {
            clearInterval(pollRef.current);
            setSyncing(false);
            await load();
            const last = st.last;
            if (last && last.ok) toast({ message: `Added ${last.added} item${last.added === 1 ? '' : 's'} to today's brief.` });
            else if (last && last.error) toast({ message: last.error, tone: 'error', duration: 6000 });
          }
        } catch { /* keep polling */ }
      }, 4000);
    } catch (err) {
      setSyncing(false);
      toast({ message: err.message, tone: 'error', duration: 6000 });
    }
  }

  async function dismiss(id) {
    try {
      await api.dismissNewsletterItem(id);
      setData(d => {
        const g = { ...d.groups };
        for (const k of Object.keys(g)) g[k] = g[k].filter(x => x.id !== id);
        return { ...d, groups: g, total: d.total - 1 };
      });
    } catch (err) { toast({ message: err.message, tone: 'error' }); }
  }

  if (loading) return <div className="text-center py-12 text-gray-500 text-sm">Loading...</div>;

  const notConfigured = status && !status.configured;
  const groups = data?.groups || { book: [], thesis: [], general: [] };
  const empty = (data?.total || 0) === 0;

  return (
    <div className="max-w-3xl mx-auto px-4 py-6">
      <div className="flex items-start justify-between gap-4 mb-5">
        <div>
          <h1 className="text-2xl font-semibold text-gray-900 tracking-tight">Daily Brief</h1>
          <p className="text-sm text-gray-500 mt-1">
            {data?.date ? new Date(data.date + 'T00:00').toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric' }) : ''}
            {data?.total ? ` · ${data.total} item${data.total === 1 ? '' : 's'}` : ''}
          </p>
        </div>
        {status?.configured && (
          <button onClick={sync} disabled={syncing} className="btn-primary text-xs px-3 py-1.5 disabled:opacity-50">
            {syncing ? 'Pulling…' : 'Sync now'}
          </button>
        )}
      </div>

      {notConfigured && (
        <div className="card p-6 text-center">
          <h3 className="text-sm font-semibold text-gray-800 mb-1">Add your newsletters</h3>
          <p className="text-xs text-gray-500 mb-4 max-w-md mx-auto">
            Add the newsletters you follow once — paste each one's website or Substack URL and Stu finds its feed.
            They'll flow into a daily brief of key takeaways automatically, no Gmail labeling needed.
          </p>
          <Link to="/settings" className="btn-primary text-xs">Add sources in Settings →</Link>
        </div>
      )}

      {status?.configured && empty && (
        <div className="card p-8 text-center">
          <div className="text-3xl mb-2">📬</div>
          <h3 className="text-sm font-semibold text-gray-700 mb-1">No items yet</h3>
          <p className="text-xs text-gray-400 mb-4">
            {status.sourceCount > 0 ? 'Hit Sync to pull the latest from your sources.' : 'Add newsletter sources in Settings, then sync.'}
          </p>
          <button onClick={sync} disabled={syncing} className="btn-primary text-xs">{syncing ? 'Pulling…' : 'Sync now'}</button>
        </div>
      )}

      <div className="space-y-6">
        {['book', 'thesis', 'general'].map(key => (
          groups[key]?.length > 0 && (
            <div key={key}>
              <h2 className={`text-sm font-semibold mb-3 flex items-center gap-2 ${GROUP_META[key].accent}`}>
                <span className={`w-2 h-2 rounded-full ${GROUP_META[key].dot}`} />
                {GROUP_META[key].title} ({groups[key].length})
              </h2>
              <div className="space-y-3">
                {groups[key].map(it => <Item key={it.id} it={it} onDismiss={dismiss} />)}
              </div>
            </div>
          )
        ))}
      </div>
    </div>
  );
}
