/**
 * Releases — a human-readable changelog of what shipped, when, and why it matters.
 * Add a new entry to the top of RELEASES for each deploy. Keep it benefit-led:
 * say what changed AND what the user gets out of it.
 */

const RELEASES = [
  {
    version: 'v2.2.0',
    date: 'June 2, 2026',
    time: '2:30 PM CT',
    title: 'Sourcing caliber, assessment trust layer, and per-role talent',
    highlights: [
      {
        product: 'Sourcing',
        change: 'Added a separate "caliber" tier (S/A/B/C) on top of the existing fit score, computed from hard signals — prior exits, top-program admits (YC / a16z Speedrun / Thiel / Neo), senior departures from category-defining companies, repeat founders. New authoritative-cohort queries run daily, and disqualifying red flags now hard-clamp weak profiles.',
        benefit: 'The inbox surfaces the best-of-the-best first and unmistakably. You can filter to "S only" and trust that an S-tier founder has real, evidence-backed proof of caliber — not just a polished headline.',
      },
      {
        product: 'Assessment',
        change: 'Every direct quote an agent cites is now verified against the source materials and tagged Verbatim / Paraphrased / Unverified. Context assembly was rebuilt to protect the freshest, highest-signal inputs instead of slicing arbitrarily at a character limit.',
        benefit: 'You get a defensible, top-decile read: click to confirm the evidence behind any score, and trust that recent call transcripts are never silently dropped. Unverified quotes are flagged so nothing unsupported slips into a memo.',
      },
      {
        product: 'Talent',
        change: 'The match queue is now focusable by role and company via the URL, with scoped status counts. Role and company pages link straight into a filtered queue showing only that search.',
        benefit: 'Running a CMO search for one company is now one click: isolate, rank, and triage candidates for that specific role without wading through every match across every company.',
      },
      {
        product: 'Platform',
        change: 'Added this Releases page.',
        benefit: 'See what changed in each update, the benefit, and when it went live.',
      },
    ],
  },
];

function ProductBadge({ product }) {
  const map = {
    Sourcing: 'bg-violet-50 text-violet-700 border-violet-200',
    Assessment: 'bg-emerald-50 text-emerald-700 border-emerald-200',
    Talent: 'bg-amber-50 text-amber-700 border-amber-200',
    Platform: 'bg-gray-100 text-gray-600 border-gray-200',
  };
  return (
    <span className={`text-[10px] font-semibold px-2 py-0.5 rounded-full border ${map[product] || map.Platform}`}>
      {product}
    </span>
  );
}

export default function Releases() {
  return (
    <div className="max-w-3xl mx-auto px-4 py-6">
      <div className="mb-6">
        <h1 className="text-2xl font-semibold text-gray-900 tracking-tight">Releases</h1>
        <p className="text-sm text-gray-500 mt-1">What's new in Stu — key changes, the benefit, and when each update went live.</p>
      </div>

      <div className="space-y-8">
        {RELEASES.map((rel) => (
          <div key={rel.version} className="relative">
            <div className="flex items-baseline gap-3 mb-3">
              <span className="text-sm font-semibold text-gray-900">{rel.version}</span>
              <span className="text-xs text-gray-400">{rel.date} · {rel.time}</span>
            </div>
            <h2 className="text-base font-semibold text-gray-900 mb-4">{rel.title}</h2>

            <div className="space-y-3">
              {rel.highlights.map((h, i) => (
                <div key={i} className="card p-4">
                  <div className="mb-2"><ProductBadge product={h.product} /></div>
                  <p className="text-sm text-gray-800">{h.change}</p>
                  <p className="text-xs text-gray-500 mt-2">
                    <span className="font-semibold text-gray-600">Why it matters: </span>
                    {h.benefit}
                  </p>
                </div>
              ))}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
