import { useState, useEffect, useRef } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../utils/api';
import { useToast } from '../components/Toast';

function Takeaways({ items }) {
  if (!items?.length) return null;
  return (
    <ul className="mt-2 space-y-1">
      {items.slice(0, 5).map((t, i) => (
        <li key={i} className="text-sm text-gray-700 flex gap-2 leading-snug"><span className="text-gray-300">•</span><span>{t}</span></li>
      ))}
    </ul>
  );
}

function ClassicCard({ c }) {
  return (
    <div className="card p-4">
      <div className="text-[10px] uppercase tracking-wide text-gray-400">{c.author}</div>
      <a href={c.url} target="_blank" rel="noopener" className="text-base font-semibold text-gray-900 hover:text-amber-700">{c.title}</a>
      {c.one_liner && <p className="text-xs text-gray-500 mt-1">{c.one_liner}</p>}
      <Takeaways items={c.takeaways} />
      <a href={c.url} target="_blank" rel="noopener" className="inline-block mt-2 text-xs font-medium text-amber-700 hover:text-amber-800">Read the full piece →</a>
    </div>
  );
}

function NewsletterCard({ n }) {
  return (
    <div className="card p-4">
      <div className="text-[10px] uppercase tracking-wide text-gray-400">{n.source}</div>
      {n.url
        ? <a href={n.url} target="_blank" rel="noopener" className="text-base font-semibold text-gray-900 hover:text-amber-700">{n.subject}</a>
        : <div className="text-base font-semibold text-gray-900">{n.subject}</div>}
      {n.summary && <p className="text-sm text-gray-700 mt-1.5 leading-snug">{n.summary}</p>}
      <Takeaways items={n.key_points} />
      {n.url && <a href={n.url} target="_blank" rel="noopener" className="inline-block mt-2 text-xs font-medium text-amber-700 hover:text-amber-800">Open →</a>}
    </div>
  );
}

export default function Brief() {
  const [digest, setDigest] = useState(null);
  const [status, setStatus] = useState(null);
  const [loading, setLoading] = useState(true);
  const [syncing, setSyncing] = useState(false);
  const [seeding, setSeeding] = useState(false);
  const [sending, setSending] = useState(false);
  const [rebuilding, setRebuilding] = useState(false);
  const pollRef = useRef(null);
  const { toast } = useToast();

  async function load() {
    try {
      const [d, st] = await Promise.all([api.getBriefToday(), api.getNewsletterStatus()]);
      setDigest(d);
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
      pollRef.current = setInterval(async () => {
        try {
          const st = await api.getNewsletterStatus();
          setStatus(st);
          if (!st.running) {
            clearInterval(pollRef.current);
            setSyncing(false);
            await load();
            if (st.last?.ok) toast({ message: `Pulled ${st.last.added} newsletter item${st.last.added === 1 ? '' : 's'}.` });
            else if (st.last?.error) toast({ message: st.last.error, tone: 'error', duration: 6000 });
          }
        } catch { /* keep polling */ }
      }, 4000);
    } catch (err) {
      setSyncing(false);
      toast({ message: err.message, tone: 'error', duration: 6000 });
    }
  }

  async function seedDefaults() {
    setSeeding(true);
    try {
      const r = await api.seedBriefDefaults();
      toast({ message: `Added ${r.added.archives} blogs + ${r.added.newsletters} newsletters. Picking today's classics…`, duration: 5000 });
      // Today's digest may have been frozen earlier with no classics — rebuild so the
      // "Learn from the greats" section appears immediately.
      setDigest(await api.rebuildBrief());
    } catch (e) { toast({ message: e.message, tone: 'error', duration: 6000 }); }
    finally { setSeeding(false); }
  }

  async function rebuild() {
    setRebuilding(true);
    try { setDigest(await api.rebuildBrief()); toast({ message: 'Rebuilt today\'s brief.' }); }
    catch (e) { toast({ message: e.message, tone: 'error' }); }
    finally { setRebuilding(false); }
  }

  async function emailMeNow() {
    setSending(true);
    try {
      const r = await api.sendBriefNow();
      if (r.ok && !r.skipped) toast({ message: `Sent to ${r.recipient} — ${r.archive} classics + ${r.newsletters} newsletters.`, duration: 6000 });
      else if (r.skipped) toast({ message: `Nothing to send: ${r.reason}.`, tone: 'error', duration: 5000 });
      else toast({ message: r.error || 'Send failed', tone: 'error', duration: 7000 });
      await load();
    } catch (e) { toast({ message: e.message, tone: 'error', duration: 7000 }); }
    finally { setSending(false); }
  }

  if (loading) return <div className="text-center py-12 text-gray-500 text-sm">Building today's brief…</div>;

  const classics = digest?.classics || [];
  const newsletters = digest?.newsletters || [];
  const isEmpty = !classics.length && !newsletters.length;
  const dateLabel = digest?.date ? new Date(digest.date + 'T12:00:00').toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric' }) : '';

  return (
    <div className="max-w-3xl mx-auto px-4 py-6">
      <div className="flex items-start justify-between gap-4 mb-5">
        <div>
          <h1 className="text-2xl font-semibold text-gray-900 tracking-tight">Daily Brief</h1>
          <p className="text-sm text-gray-500 mt-1">
            {dateLabel}
            {digest?.emailed && <span className="ml-2 text-emerald-600">· emailed to {digest.emailed.recipient}</span>}
          </p>
        </div>
        <div className="flex items-center gap-2 flex-shrink-0">
          <button onClick={emailMeNow} disabled={sending} className="btn-secondary text-xs px-3 py-1.5 disabled:opacity-50" title="Email this exact digest to your inbox">
            {sending ? 'Sending…' : '✉ Email it to me'}
          </button>
          <button onClick={sync} disabled={syncing} className="btn-primary text-xs px-3 py-1.5 disabled:opacity-50">
            {syncing ? 'Pulling…' : 'Sync newsletters'}
          </button>
        </div>
      </div>

      {/* One-tap setup */}
      <div className="card p-4 mb-6 flex items-center justify-between gap-4">
        <div>
          <div className="text-sm font-semibold text-gray-900">One digest — here and in your inbox</div>
          <p className="text-xs text-gray-500 mt-0.5">
            A daily classic from Paul Graham, Bill Gurley & Andrew Chen, a chapter from Elad Gil's High Growth Handbook,
            and summaries of the newsletters you receive. The same digest you see here is emailed to you each morning.
          </p>
        </div>
        <button onClick={seedDefaults} disabled={seeding} className="btn-primary text-xs px-3 py-1.5 whitespace-nowrap disabled:opacity-50" title="Adds Paul Graham, Bill Gurley, Andrew Chen & Elad Gil plus the key newsletters. Safe to click — it never removes anything you already have.">
          {seeding ? 'Setting up…' : 'Add the greats & newsletters'}
        </button>
      </div>

      {isEmpty && (
        <div className="card p-8 text-center">
          <div className="text-3xl mb-2">📬</div>
          <h3 className="text-sm font-semibold text-gray-700 mb-1">Nothing here yet</h3>
          <p className="text-xs text-gray-400 mb-4 max-w-sm mx-auto">
            Click <strong>Set up my Daily Brief</strong> to add the blogs and newsletters, then <strong>Sync newsletters</strong> to pull the latest issues.
          </p>
        </div>
      )}

      {classics.length > 0 && (
        <section className="mb-8">
          <h2 className="text-sm font-semibold uppercase tracking-wide text-gray-500 mb-3">Learn from the greats</h2>
          <div className="space-y-3">{classics.map((c, i) => <ClassicCard key={i} c={c} />)}</div>
        </section>
      )}

      {newsletters.length > 0 && (
        <section>
          <div className="flex items-center justify-between mb-3">
            <h2 className="text-sm font-semibold uppercase tracking-wide text-gray-500">Newsletters</h2>
            <button onClick={rebuild} disabled={rebuilding} className="text-[11px] text-gray-400 hover:text-gray-600 disabled:opacity-50">{rebuilding ? 'Rebuilding…' : 'Regenerate'}</button>
          </div>
          <div className="space-y-3">{newsletters.map((n, i) => <NewsletterCard key={i} n={n} />)}</div>
        </section>
      )}
    </div>
  );
}
