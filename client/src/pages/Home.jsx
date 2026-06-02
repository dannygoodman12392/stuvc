import { useState, useEffect } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../utils/api';

const TIER_CLS = {
  S: 'bg-violet-100 text-violet-700 border-violet-300',
  A: 'bg-amber-100 text-amber-700 border-amber-300',
  B: 'bg-emerald-50 text-emerald-700 border-emerald-200',
  C: 'bg-gray-100 text-gray-500 border-gray-200',
};
const STATUS_CLS = 'text-[10px] text-gray-500 bg-gray-100 px-1.5 py-0.5 rounded';

function SectionHeader({ title, sub, action }) {
  return (
    <div className="flex items-end justify-between mb-3">
      <div>
        <h2 className="text-sm font-semibold text-gray-900">{title}</h2>
        {sub && <p className="text-xs text-gray-400 mt-0.5">{sub}</p>}
      </div>
      {action}
    </div>
  );
}

export default function Home() {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    api.getHome().then(setData).catch(() => setData(null)).finally(() => setLoading(false));
  }, []);

  if (loading) return <div className="text-center py-12 text-gray-500 text-sm">Loading...</div>;
  const d = data || {};
  const greeting = (() => { const h = new Date().getHours(); return h < 12 ? 'Good morning' : h < 18 ? 'Good afternoon' : 'Good evening'; })();
  const firstName = (d.user?.name || '').split(' ')[0];

  return (
    <div className="max-w-3xl mx-auto px-4 py-8 space-y-8">
      <div>
        <h1 className="text-2xl font-semibold text-gray-900 tracking-tight">
          {greeting}{firstName ? `, ${firstName}` : ''}
        </h1>
        <p className="text-sm text-gray-500 mt-1">
          {new Date().toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric' })}
        </p>
      </div>

      {/* 1 — Catch up: the brief */}
      <section>
        <SectionHeader
          title="Worth your attention"
          sub="The most relevant reads from your newsletters"
          action={<Link to="/brief" className="text-xs text-amber-700 hover:text-amber-800">Full brief →</Link>}
        />
        {(d.brief?.topItems || []).length === 0 ? (
          <div className="card p-5 text-sm text-gray-400">
            No newsletter items yet. <Link to="/settings" className="text-amber-700 hover:underline">Add sources →</Link>
          </div>
        ) : (
          <div className="space-y-2.5">
            {d.brief.topItems.map(it => (
              <div key={it.id} className="card p-4">
                <div className="flex items-center gap-2 mb-1">
                  <span className="text-sm font-semibold text-gray-900">{it.source_name}</span>
                  {it.received_at && <span className="text-[10px] text-gray-400">{new Date(it.received_at).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}</span>}
                  {it.relevance_score >= 65 && <span className="text-[9px] font-semibold px-1.5 py-0.5 rounded-full bg-violet-50 text-violet-700 border border-violet-200">Relevant</span>}
                  {it.url && <a href={it.url} target="_blank" rel="noopener" className="ml-auto text-[11px] text-amber-700 hover:underline">read →</a>}
                </div>
                {it.summary && <p className="text-sm text-gray-700">{it.summary}</p>}
                {it.key_points?.length > 0 && (
                  <ul className="mt-1.5 space-y-0.5">
                    {it.key_points.slice(0, 3).map((p, i) => <li key={i} className="text-xs text-gray-500 flex gap-2"><span className="text-gray-300">•</span><span>{p}</span></li>)}
                  </ul>
                )}
              </div>
            ))}
          </div>
        )}
      </section>

      {/* 2 — Have a look: the pipeline */}
      <section>
        <SectionHeader
          title="Your pipeline"
          sub={`${d.pipeline?.activeCount || 0} active · ${d.sourcing?.pending || 0} in the inbox${d.sourcing?.topCaliber ? ` (${d.sourcing.topCaliber} top-caliber)` : ''}`}
          action={<Link to="/pipeline" className="text-xs text-amber-700 hover:text-amber-800">Open pipeline →</Link>}
        />
        {(d.pipeline?.active || []).length === 0 ? (
          <div className="card p-5 text-sm text-gray-400">
            No active deals yet. <Link to="/pipeline" className="text-amber-700 hover:underline">Review the inbox →</Link>
          </div>
        ) : (
          <div className="card divide-y divide-gray-100">
            {d.pipeline.active.map(f => (
              <Link key={f.id} to={`/founders/${f.id}`} className="flex items-center gap-2.5 px-4 py-2.5 hover:bg-gray-50">
                {f.caliber_tier && <span className={`text-[10px] font-bold px-1.5 py-0.5 rounded border ${TIER_CLS[f.caliber_tier] || TIER_CLS.C}`}>{f.caliber_tier}</span>}
                <div className="min-w-0 flex-1">
                  <span className="text-sm font-medium text-gray-900">{f.name}</span>
                  {f.company && <span className="text-xs text-gray-500"> · {f.company}</span>}
                </div>
                {f.status && <span className={STATUS_CLS}>{f.status}</span>}
              </Link>
            ))}
          </div>
        )}
      </section>

      {/* 3 — Portfolio support: hiring */}
      <section>
        <SectionHeader
          title="Portfolio support — hiring"
          sub="Open roles you're helping fill"
          action={<Link to="/talent/roles" className="text-xs text-amber-700 hover:text-amber-800">All roles →</Link>}
        />
        {(d.talent?.openRoles || []).length === 0 ? (
          <div className="card p-5 text-sm text-gray-400">
            No open roles. <Link to="/talent" className="text-amber-700 hover:underline">Open Talent →</Link>
          </div>
        ) : (
          <div className="card divide-y divide-gray-100">
            {d.talent.openRoles.map(r => (
              <Link key={r.id} to={`/talent/matches?role=${r.id}`} className="flex items-center justify-between px-4 py-2.5 hover:bg-gray-50">
                <div className="min-w-0">
                  <span className="text-sm font-medium text-gray-900">{r.title}</span>
                  {r.company_name && <span className="text-xs text-gray-500"> · {r.company_name}</span>}
                </div>
                {r.newMatches > 0
                  ? <span className="text-[10px] font-semibold px-2 py-0.5 rounded-full bg-amber-50 text-amber-700 border border-amber-200 flex-shrink-0">{r.newMatches} to review</span>
                  : <span className="text-[10px] text-gray-400 flex-shrink-0">no new matches</span>}
              </Link>
            ))}
          </div>
        )}
      </section>
    </div>
  );
}
