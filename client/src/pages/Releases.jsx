/**
 * Releases — a human-readable changelog of what shipped, when, and why it matters.
 * Add a new entry to the top of RELEASES for each deploy. Keep it benefit-led:
 * say what changed AND what the user gets out of it.
 */

const RELEASES = [
  {
    version: 'v4.2.0',
    date: 'July 1, 2026',
    time: '3:30 PM CT',
    title: 'Sift the pipeline — by program, school, and tie',
    highlights: [
      {
        product: 'Sourcing',
        change: 'The Sourced inbox now has a sift bar: filter by Program (YC, a16z Speedrun, Z Fellows, Neo, Thiel, The Residency, Emergent Ventures, trademark filings, web discovery), by School (UChicago, Northwestern, U of I, Illinois Tech, Loyola, DePaul), and by Tie type (in Chicago now / IL school / from IL / worked here / ex-Chicago company) — plus the existing caliber, fit, and search. Everything stacks.',
        benefit: 'Answer questions like "show me the UChicago YC founders" or "just the Speedrun people" in one click.',
      },
      {
        product: 'Sourcing',
        change: 'New Chicago Pipeline vs Frontier Watch toggle. Your deal pipeline stays strictly IL-tied; flip to Frontier Watch to browse the promising national (non-IL) builders we keep for thesis work — the ones that used to be dropped.',
        benefit: 'See the national frontier picture without cluttering your Chicago deal flow.',
      },
      {
        product: 'Sourcing',
        change: 'Coverage fix: the Pipeline keys on all five Illinois tie types, so it captures both people currently in Chicago and promising people with IL roots elsewhere (school, hometown, prior work) — and the "Run" button now refreshes the YC/cohort connectors on demand, not just on the daily job.',
        benefit: 'One Pipeline that finds everyone in Chicago plus the IL-rooted builders anywhere — and you can pull fresh results whenever you want.',
      },
    ],
  },
  {
    version: 'v4.1.0',
    date: 'July 1, 2026',
    time: '1:30 PM CT',
    title: 'Cohort sourcing + a national frontier watch',
    highlights: [
      {
        product: 'Sourcing',
        change: 'New Y Combinator connector: every YC company flows into Stu automatically each day, filtered to pre-seed/early-stage only (growth-stage alumni like Tovala, ShipBob, Fly.io, and anything acquired/public are excluded). Crucially, Stu now reads each company\'s founders and their backgrounds — so it matches on the founder\'s Illinois tie (went to UChicago / U of I / Northwestern, is from here, or worked here), not just where the company is headquartered. First run found 23 IL-tied founders, most of them UChicago alumni whose companies are based outside Chicago — people location-only sourcing would have missed entirely.',
        benefit: 'You catch Chicago-rooted founders wherever their company is based, and never waste time on companies that raised years ago.',
      },
      {
        product: 'Sourcing',
        change: 'New national "frontier watch": promising builders we find who are NOT IL-tied used to be dropped. Now the strong ones (starting with national YC companies) are kept on a separate watchlist that feeds thesis work, instead of vanishing — your deal pipeline stays strictly Chicago-first.',
        benefit: 'Keep the Chicago-first pipeline clean while still seeing the national picture you want for thesis calls.',
      },
      {
        product: 'Sourcing',
        change: 'High-signal programs now resolve to founders too, the same way YC does — Thiel Fellows, Z Fellows, Neo, a16z Speedrun, The Residency, and Emergent Ventures. Since these programs don\'t publish a usable member list, Stu finds the actual people via web search and matches on each person\'s Illinois tie (UChicago / U of I / Northwestern, from here, or worked here), routing IL-tied founders to your pipeline and the rest to the national watch. Runs on your own Exa key.',
        benefit: 'The people coming out of the most competitive young-founder programs surface early — filtered to the ones connected to Chicago.',
      },
    ],
  },
  {
    version: 'v4.0.0',
    date: 'June 19, 2026',
    time: '10:15 PM CT',
    title: 'Discover, alerts, outreach — and connect your own AI agent',
    highlights: [
      {
        product: 'Sourcing',
        change: 'New Discover: instead of waiting for the daily sweep, go find fresh builders from the live web on demand by signal — founders who just left a YC company, stealth founders building something new, early employees who left a unicorn factory (OpenAI, Stripe, Ramp…), repeat founders, breakout open-source builders, and more. Results come back ranked, scored 0–100, and explained with a one-line "why this person," and are saved straight to your queue. Works even on a brand-new, empty account.',
        benefit: 'Ask once and get a scored, explained shortlist of exceptional builders in seconds — no setup, no waiting for a sweep.',
      },
      {
        product: 'Talent',
        change: 'The same builder-signal filters now power hiring, and you can Discover candidates the same way — find people who just left a top company or just went stealth, ranked and scored for the role you\'re filling. Plus one-click Outreach: turn any discovered person into a warm, personalized message (recruit / invest / connect), drafted in seconds.',
        benefit: 'Go from "find me someone" to a ready-to-send intro without leaving the page.',
      },
      {
        product: 'Platform',
        change: 'New Monitors: set a standing alert like "tell me when a YC founder just leaves" and Stu collects the hits for you — and an active monitor will go discover new ones from the web every day. Read them in the app or pull them from your agent.',
        benefit: 'Catch the highest-signal moment — the moment someone becomes available — without checking manually.',
      },
      {
        product: 'Platform',
        change: 'Stu now speaks MCP: connect your own AI agent (Claude Desktop, Cursor, a script) directly to your Talent and Sourcing data, discovery, and monitors. Generate an access token in Settings → API & MCP Access and point your agent at stu.vc/mcp, then just ask it "find me YC founders who just left." Stu is free with an account, bring-your-own-key: your usage runs on your own API keys (encrypted at rest, with a daily spend cap), so you control cost and Stu never bills you.',
        benefit: 'Drive Stu from the AI tools you already use, on your own keys — your data, your cost, your control.',
      },
    ],
  },
  {
    version: 'v3.1.0',
    date: 'June 3, 2026',
    time: '4:45 PM CT',
    title: 'Tier 5: a taste profile you can audit + an exploration lane',
    highlights: [
      {
        product: 'Sourcing',
        change: 'Your approve/pass history now produces a falsifiable taste profile: plain-English statements ("you advance ex-hyperscaler founders 3.2× your base rate") each linked to the specific founders behind them, with a confidence level — view it from the inbox. Added an exploration lane that surfaces a few high-caliber founders OUTSIDE your usual pattern, so the funnel never collapses into a monoculture. The learned taste re-ranks but never overrides the hard Chicago/IL-tie requirement.',
        benefit: 'See (and correct) what Stu has learned about your taste, and keep discovering great founders you might otherwise filter out.',
      },
    ],
  },
  {
    version: 'v3.0.0',
    date: 'June 3, 2026',
    time: '3:30 PM CT',
    title: 'Talent: one guided workspace (company → role → source)',
    highlights: [
      {
        product: 'Talent',
        change: 'Rebuilt the Talent landing into a single guided workspace. Add a company (with a one-liner of what it does), add a role to it (pick the function — Engineering, Go-to-Market, Customer Success, Product, Design, Ops, Finance), and hit "Source for this role" — all on one screen. Collapsed the confusing 7-tab nav to Companies & Roles / Candidates / Matches / Criteria. Added a proper Customer Success function so CS roles source and score on retention/expansion, not engineering or generic GTM criteria.',
        benefit: 'The whole hiring flow is one obvious path now, and every role sources the right kind of person.',
      },
    ],
  },
  {
    version: 'v2.9.4',
    date: 'June 3, 2026',
    time: '2:30 PM CT',
    title: 'Tier 4: dedup the brief, enforce must-haves in Talent',
    highlights: [
      {
        product: 'Daily Brief',
        change: 'The same story arriving from multiple newsletters now collapses to one entry (matched by shared link or near-identical headline), instead of cluttering the feed with duplicates.',
        benefit: 'A cleaner brief — one entry per story, even when three newsletters cover it.',
      },
      {
        product: 'Talent',
        change: 'A role\'s "must-haves" are now enforced in matching — candidates showing no evidence of the non-negotiables are penalized and flagged, instead of must-haves being ignored.',
        benefit: 'Matches respect your hard requirements, not just keyword overlap.',
      },
    ],
  },
  {
    version: 'v2.9.3',
    date: 'June 3, 2026',
    time: '1:30 PM CT',
    title: 'Tier 4: IL-tie gate stress-tested + hardened',
    highlights: [
      {
        product: 'Sourcing',
        change: 'Stress-tested the Chicago/IL tie gate against a battery of adversarial profiles and caught a false positive: a "Chicago Bears superfan" building in SF was being accepted because a sports-team mention tripped the location match. Now brand/team/media phrases ("Chicago Bears", "Chicago Tribune", etc.) can no longer count as a tie. Locked with 10 regression cases.',
        benefit: 'Only genuine Chicago/Illinois connections count — no founder slips in on an incidental mention of the city.',
      },
    ],
  },
  {
    version: 'v2.9.2',
    date: 'June 3, 2026',
    time: '12:30 PM CT',
    title: 'Tier 3: evidence + sources on every founder',
    highlights: [
      {
        product: 'Sourcing',
        change: 'Each founder card now has a "Show evidence & sources" view: the Chicago/IL tie, caliber, stage, and sector each show the verbatim quote behind them, a ✓ verbatim / ⚠ unverified marker, and a link to the source profile. Attributes without a real quote are flagged unverified — never presented as fact.',
        benefit: 'You can see the proof behind every founder at a glance — only the best, with receipts.',
      },
    ],
  },
  {
    version: 'v2.9.1',
    date: 'June 3, 2026',
    time: '11:40 AM CT',
    title: 'Tier 2 complete: mirror integrity',
    highlights: [
      {
        product: 'Platform',
        change: 'Confirmed (and locked with a test) that the startup Airtable import is additive-only — it never overwrites your canonical SQLite data. Hardened the Notion mirror: pushes now retry transient failures and verify the page exists afterward (read-back). Added a Notion drift check on the Health page — see any investment-track founder missing from Notion and one-click re-push them from SQLite.',
        benefit: 'Your data stays canonical in Stu, your Notion mirror stays in sync, and you can see/repair any drift in seconds.',
      },
    ],
  },
  {
    version: 'v2.9.0',
    date: 'June 3, 2026',
    time: '10:30 AM CT',
    title: 'Tier 2: atomic approvals + evidence carried on promotion',
    highlights: [
      {
        product: 'Sourcing',
        change: 'Approving a founder from the inbox is now a single atomic operation — a crash or double-click can no longer create a duplicate or an orphaned record. And the full sourcing evidence (caliber tier/score, signals, the verbatim evidence map, red flags) now travels with the founder into the pipeline instead of being dropped. Existing promoted founders were backfilled with their evidence where the source still exists.',
        benefit: 'No duplicate/lost founders on approval, and you keep the proof of why each founder was surfaced.',
      },
    ],
  },
  {
    version: 'v2.8.2',
    date: 'June 3, 2026',
    time: '9:30 AM CT',
    title: 'Sourcing inbox: clearer caliber vs. fit',
    highlights: [
      {
        product: 'Sourcing',
        change: 'Removed the confusing double-score on founder cards. The big mark is now the caliber tier (S/A/B/C — matching the section it\'s in), and the 1–10 number is clearly labeled "Fit." Added a one-line legend explaining the two axes — a top-caliber founder can still have a modest Fit if their public signal is thin.',
        benefit: 'No more "why is there a 4 in Best-of-Best?" — the card reads cleanly at a glance.',
      },
    ],
  },
  {
    version: 'v2.8.1',
    date: 'June 3, 2026',
    time: '8:45 AM CT',
    title: 'No more silent failures + a Health board',
    highlights: [
      {
        product: 'Platform',
        change: 'Newsletter sync now reports failure honestly — if any source fails, the run is no longer "green." Every job (Brief sync, sourcing run, Notion push, publish-to-team) records its outcome to a durable log. New Health tab shows a 5-second green/red board: datastores, API keys, last run of each job, failing newsletter sources, duplicate founders, suspect decks.',
        benefit: 'You can tell at a glance whether everything actually ran — and exactly what to fix when it didn\'t.',
      },
    ],
  },
  {
    version: 'v2.8.0',
    date: 'June 3, 2026',
    time: '7:10 AM CT',
    title: 'Assessment decks: real ingestion, never a silent corrupt score',
    highlights: [
      {
        product: 'Founder Assessment',
        change: 'PDF decks are now extracted to text server-side (they were being corrupted before upload). PowerPoint is rejected with a clear "export to PDF" message. A deck that\'s a DocSend/Slides link or an unreadable file is explicitly marked "not ingested" so the agents never score on garbage. Past assessments with corrupted/un-ingested decks are flagged "suspect" with a banner.',
        benefit: 'Assessment scores are trustworthy because they\'re based on the real deck — or clearly flagged when they aren\'t.',
      },
    ],
  },
  {
    version: 'v2.7.3',
    date: 'June 3, 2026',
    time: '3:30 AM CT',
    title: 'P0: stop auto-pushing unvetted founders to the team Airtable',
    highlights: [
      {
        product: 'Platform',
        change: 'Airtable (the team\'s shared base) was being auto-written on every stage change and on every Sourcing approval — putting in-progress founder data in front of the team. All auto-pushes are removed and the Airtable writers now refuse unless called via a deliberate "publish to team" action. SQLite stays canonical; nothing reaches the team base by accident.',
        benefit: 'Your team only sees founders you deliberately publish — never half-baked pipeline data.',
      },
    ],
  },
  {
    version: 'v2.7.2',
    date: 'June 3, 2026',
    time: '2:00 AM CT',
    title: 'Sourcing: accurate tags and descriptions',
    highlights: [
      {
        product: 'Sourcing',
        change: 'Fixed inaccurate founder tags. The old extractor used loose text matching, so "submit" could tag someone "MIT", "metadata" could tag "Ex-Meta", and "NYC" could read as "YC". Now it requires word boundaries and real employment context, every pedigree tag is verified against the actual profile, and the AI is held to strict accuracy rules (no inferring schools/employers, no inventing a company). Existing inbox tags were scrubbed of unsupported claims.',
        benefit: 'Tags and descriptions reflect what a founder\'s profile actually says — so you can trust the inbox at a glance.',
      },
    ],
  },
  {
    version: 'v2.7.1',
    date: 'June 3, 2026',
    time: '1:15 AM CT',
    title: 'Talent: role function read from the title/JD, like a real recruiter',
    highlights: [
      {
        product: 'Talent',
        change: 'Fixed the CMO-still-showing-engineers bug at the root. The matcher was reading a role\'s function from a config field that defaulted to "engineering" for older roles. Now Stu reads the function straight from the role title and job description — "CMO" is go-to-market, "Founding Engineer" is engineering — so matching and sourcing follow the actual role, not a stale setting. Existing roles were re-typed and mismatched matches cleared.',
        benefit: 'A role you create just works: name it CMO and it sources and matches go-to-market people, no setup. After this, "Source for this role" on the CMO will pull real marketing candidates.',
      },
    ],
  },
  {
    version: 'v2.7.0',
    date: 'June 2, 2026',
    time: '12:40 AM CT',
    title: 'Sourcing learns from your decisions',
    highlights: [
      {
        product: 'Sourcing',
        change: 'The engine now learns from your taste. Every founder you approve or star is a "like"; every dismiss is a "pass." Stu compares them to learn which signals predict your preferences, then feeds that back two ways: it calibrates the AI scoring prompt, and it ranks founders who match your taste higher (an "affinity" nudge). The hard rules — verified Chicago/IL tie, founders-only — are never overridden. A quiet "Learning from your taste" line shows what it has picked up.',
        benefit: 'The more you use the inbox, the more it surfaces the kind of founder you actually like — without you configuring anything.',
      },
    ],
  },
  {
    version: 'v2.6.3',
    date: 'June 2, 2026',
    time: '11:55 PM CT',
    title: 'Sourcing: a Chicago/Illinois tie is now mandatory',
    highlights: [
      {
        product: 'Sourcing',
        change: 'Closed a loophole where founders with no local tie could slip through. A verified Chicago/Illinois connection — lives/works here, went to school here, from here, or worked at a Chicago company — is now required for every founder, and the existing inbox was cleaned of untied founders.',
        benefit: 'Every founder in your inbox has a real reason to be in Chicago/Illinois.',
      },
    ],
  },
  {
    version: 'v2.6.2',
    date: 'June 2, 2026',
    time: '11:20 PM CT',
    title: 'Talent: candidates matched to the right role type',
    highlights: [
      {
        product: 'Talent',
        change: 'Fixed the core matching flaw: the matcher was function-blind, so engineers were scoring as matches for a CMO role. Every candidate is now typed by function (engineering / go-to-market / product / design / ops / finance), and a hard gate ensures a role only matches candidates of the same function. Existing mismatched matches were cleared.',
        benefit: 'A CMO/GTM search shows go-to-market people only — never engineers. Set a role\'s Function, then "Source for this role" to fill it with the right candidates.',
      },
    ],
  },
  {
    version: 'v2.6.0',
    date: 'June 2, 2026',
    time: '10:30 PM CT',
    title: 'Home dashboard + more reliable newsletter add',
    highlights: [
      {
        product: 'Platform',
        change: 'New Home dashboard (now the landing page after login): a "what needs you today" action strip, plus glimpses of top founders to review, your open roles with new-match counts, and the latest from your Daily Brief. Pipeline moved to its own tab. Also added an auto-refresh prompt so you never sit on a stale page after a deploy.',
        benefit: 'Open Stu and immediately see what to act on, without digging through tabs.',
      },
      {
        product: 'Daily Brief',
        change: 'Hardened RSS auto-discovery — sends a real browser user-agent, follows redirects, and tries many feed paths (Substack, WordPress, Ghost, beehiiv, Hugo/Jekyll), so adding a newsletter by its homepage URL now works for far more sources.',
        benefit: 'Paste a newsletter\'s site URL and Stu finds its feed reliably.',
      },
    ],
  },
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
