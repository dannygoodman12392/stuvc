/**
 * Releases — a human-readable changelog of what shipped, when, and why it matters.
 * Add a new entry to the top of RELEASES for each deploy. Keep it benefit-led:
 * say what changed AND what the user gets out of it.
 */

const RELEASES = [
  {
    version: 'v2.5.0',
    date: 'June 2, 2026',
    time: '9:40 PM CT',
    title: 'Daily Brief: automated multi-source newsfeed (RSS)',
    highlights: [
      {
        product: 'Platform',
        change: 'The Daily Brief is now a managed, automated newsfeed. Add a newsletter once in Settings — paste its website/Substack URL and Stu auto-discovers the RSS feed (or add an email-only newsletter by sender). No more Gmail labeling. The brief is now a rolling multi-day feed of key takeaways across all your sources, ranked by relevance to your pipeline and thesis, refreshed every morning.',
        benefit: 'Set your newsletters once and skim the key points from all of them in one continuous feed — add or remove sources anytime.',
      },
    ],
  },
  {
    version: 'v2.4.4',
    date: 'June 2, 2026',
    time: '8:45 PM CT',
    title: 'Daily Brief: reliable Gmail label sync',
    highlights: [
      {
        product: 'Platform',
        change: 'Fixed newsletter sync failing to open the Gmail label: Stu now lists your real labels and matches yours flexibly (case/nesting differences), and if it still can\'t find it, tells you exactly which labels it can see. Sync now pulls the newest tagged issues whether or not they\'re already read, and the daily auto-refresh (6 AM CT) is wired up correctly.',
        benefit: 'Hitting Sync now actually pulls your tagged newsletters, and the brief fills in each morning on its own.',
      },
    ],
  },
  {
    version: 'v2.4.3',
    date: 'June 2, 2026',
    time: '8:10 PM CT',
    title: 'Fix: Settings page would not load',
    highlights: [
      {
        product: 'Platform',
        change: 'Fixed a bug introduced with the Newsletters settings tab that caused the entire Settings page to render blank.',
        benefit: 'Settings opens normally again, including the Newsletters setup for the Daily Brief.',
      },
    ],
  },
  {
    version: 'v2.4.2',
    date: 'June 2, 2026',
    time: '7:30 PM CT',
    title: 'Caliber now rewards great builders, not just credentials',
    highlights: [
      {
        product: 'Sourcing',
        change: 'Broadened the caliber grade so a YC/exit/elite badge is just ONE path to the top tiers — not a requirement. Real traction (paying customers, revenue, users), a shipped-and-scaled product, deep elite-company experience, and notable open-source now lift a founder to A or S on their own. The historic inbox was re-graded on this broader scale, and Tier C is reframed as "limited public signal," not low quality.',
        benefit: 'The best builders in Chicago/Illinois rise to the top whether or not they have a brand-name credential. The credentialed founders are still found and surfaced — nothing was narrowed.',
      },
    ],
  },
  {
    version: 'v2.4.1',
    date: 'June 2, 2026',
    time: '6:45 PM CT',
    title: 'Sourcing: founders only, no duplicates, re-scored history',
    highlights: [
      {
        product: 'Sourcing',
        change: 'Added a hard "founder gate" that filters out investors, fund/accelerator staff (e.g. an a16z Speedrun team member), and recruiters — only real founders/builders get through. Tightened deduplication so each person appears once, even when one hit lists a company and another says "stealth." Cohort searches now exclude investor/team language. Ran a one-time cleanup over your existing inbox: dropped non-founders, collapsed duplicates, and re-scored everyone on the new caliber system.',
        benefit: 'Your inbox is now just the best founders with Chicago/Illinois ties — one clean entry each, graded on the new S/A/B/C caliber scale.',
      },
    ],
  },
  {
    version: 'v2.4.0',
    date: 'June 2, 2026',
    time: '5:30 PM CT',
    title: 'Daily Brief — your newsletters in one feed',
    highlights: [
      {
        product: 'Platform',
        change: 'New Daily Brief: tag newsletters with a Gmail label and Stu pulls them in, extracts the key points of each issue, and ranks them — items that touch your pipeline first, then your thesis, then general reads. Set it up in Settings → Newsletters (Gmail address + App Password + label), then hit Sync. Refreshes automatically each morning.',
        benefit: 'Get the gist of every newsletter you follow in one place, in a couple of minutes, with the stuff relevant to your deals surfaced to the top — and a link to read the full issue when you want.',
      },
    ],
  },
  {
    version: 'v2.3.0',
    date: 'June 2, 2026',
    time: '4:15 PM CT',
    title: 'Role-archetype scoring for Talent',
    highlights: [
      {
        product: 'Talent',
        change: 'Each role now has a Function (Engineering, Go-to-Market, Product, Design, Operations, Finance, Generalist). The candidate caliber rubric AND the sourcing queries now adapt to it — a CMO search is judged on scaled revenue, named campaigns, and 0→1 GTM builds, and sources from elite go-to-market orgs, not founding-engineer signals.',
        benefit: 'Searches for non-engineering roles finally surface and rank the right people. Set the Function on a role, then Source / Rescore to use the matching rubric.',
      },
    ],
  },
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
