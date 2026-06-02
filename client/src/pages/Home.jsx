import { useState, useEffect } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../utils/api';

const TIER_CLS = {
  S: 'bg-violet-100 text-violet-700 border-violet-300',
  A: 'bg-amber-100 text-amber-700 border-amber-300',
  B: 'bg-emerald-50 text-emerald-700 border-emerald-200',
  C: 'bg-gray-100 text-gray-500 border-gray-200',
};

function Card({ title, action, children }) {
  return (
    <div className="card p-4">
      <div className="flex items-center justify-between mb-3">
        <h2 className="text-sm font-semibold text-gray-900">{title}</h2>
        {action}
      </div>
      {children}
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
  const greeting = (() => {
    const h = new Date().getHours();
    return h < 12 ? 'Good morning' : h < 18 ? 'Good afternoon' : 'Good evening';
  })();
  const firstName = (d.user?.name || '').split(' ')[0];

  return (
    <div className="max-w-5xl mx-auto px-4 py-6 space-y-6">
      <div>
        <h1 className="text-2xl font-semibold text-gray-900 tracking-tight">
          {greeting}{firstName ? `, ${firstName}` : ''}
        </h1>
        <p className="text-sm text-gray-500 mt-1">
          {new Date().toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric' })}
          {d.pipeline ? ` · ${d.pipeline.active} active deals · ${d.pipeline.total} founders tracked` : ''}
        </p>
      </div>

      {/* Next actions */}
      {d.nextActions?.length > 0 && (
        <div className="flex flex-wrap gap-2">
          {d.nextActions.map((a, i) => (
            <Link key={i} to={a.link}
              className="flex items-center gap-2 text-sm bg-gray-900 text-white pl-3 pr-2 py-1.5 rounded-full hover:bg-gray-800 transition-colors">
              {a.label}
              <span className="text-[10px] bg-white/20 px-1.5 py-0.5 rounded-full">{a.cta} →</span>
            </Link>
          ))}
        </div>
      )}

      {/* Quick actions */}
      <div className="flex flex-wrap gap-2">
        {[
          ['/pipeline', 'Find founders'],
          ['/assess', 'New assessment'],
          ['/brief', 'Daily Brief'],
          ['/ask', 'Ask Stu'],
        ].map(([to, label]) => (
          <Link key={to} to={to} className="text-xs font-medium px-3 py-1.5 rounded-lg border border-gray-200 text-gray-600 hover:border-gray-300 hover:text-gray-900 transition-colors">
            {label}
          </Link>
        ))}
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
        {/* Sourcing */}
        <Card title="Top founders to review" action={<Link to="/pipeline" className="text-xs text-amber-700 hover:text-amber-800">Inbox ({d.sourcing?.pending || 0}) →</Link>}>
          {(d.sourcing?.topFounders || []).length === 0 ? (
            <p className="text-xs text-gray-400">No founders in the inbox yet. Run a sourcing pass from the Inbox.</p>
          ) : (
            <div className="space-y-2">
              {d.sourcing.topFounders.map(f => (
                <div key={f.id} className="flex items-center gap-2.5">
                  <span className={`text-[10px] font-bold px-1.5 py-0.5 rounded border ${TIER_CLS[f.caliber_tier] || TIER_CLS.C}`}>{f.caliber_tier || 'C'}</span>
                  <div className="min-w-0 flex-1">
                    <span className="text-sm font-medium text-gray-900">{f.name}</span>
                    <span className="text-xs text-gray-500 truncate"> · {f.company || f.company_one_liner || 'Stealth'}{f.chicago_connection ? ` · ${f.chicago_connection}` : ''}</span>
                  </div>
                  {f.linkedin_url && <a href={f.linkedin_url} target="_blank" rel="noopener" className="text-[10px] text-blue-600 hover:underline flex-shrink-0">LI</a>}
                </div>
              ))}
            </div>
          )}
        </Card>

        {/* Open roles */}
        <Card title="Open roles" action={<Link to="/talent/roles" className="text-xs text-amber-700 hover:text-amber-800">All roles →</Link>}>
          {(d.talent?.openRoles || []).length === 0 ? (
            <p className="text-xs text-gray-400">No open roles. Add one in Talent.</p>
          ) : (
            <div className="space-y-2">
              {d.talent.openRoles.map(r => (
                <Link key={r.id} to={`/talent/matches?role=${r.id}`} className="flex items-center justify-between hover:bg-gray-50 -mx-2 px-2 py-1 rounded">
                  <div className="min-w-0">
                    <span className="text-sm font-medium text-gray-900">{r.title}</span>
                    {r.company_name && <span className="text-xs text-gray-500"> · {r.company_name}</span>}
                  </div>
                  {r.newMatches > 0
                    ? <span className="text-[10px] font-semibold px-2 py-0.5 rounded-full bg-amber-50 text-amber-700 border border-amber-200 flex-shrink-0">{r.newMatches} new</span>
                    : <span className="text-[10px] text-gray-400 flex-shrink-0">—</span>}
                </Link>
              ))}
            </div>
          )}
        </Card>
      </div>

      {/* Daily Brief */}
      <Card title="From your Daily Brief" action={<Link to="/brief" className="text-xs text-amber-700 hover:text-amber-800">Full brief →</Link>}>
        {(d.brief?.topItems || []).length === 0 ? (
          <p className="text-xs text-gray-400">No newsletter items yet. Add sources in Settings → Newsletters.</p>
        ) : (
          <div className="space-y-3">
            {d.brief.topItems.map(it => (
              <div key={it.id}>
                <div className="flex items-center gap-2">
                  <span className="text-sm font-semibold text-gray-900">{it.source_name}</span>
                  {it.url && <a href={it.url} target="_blank" rel="noopener" className="text-[11px] text-amber-700 hover:underline">read →</a>}
                </div>
                {it.summary && <p className="text-xs text-gray-600 mt-0.5">{it.summary}</p>}
              </div>
            ))}
          </div>
        )}
      </Card>
    </div>
  );
}
