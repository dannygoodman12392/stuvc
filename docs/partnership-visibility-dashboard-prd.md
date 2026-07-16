# PRD: Partnership Visibility Dashboard (Stu-native)

Status: **Scoping — not yet approved for build.** Danny is explicitly unconvinced this is the right move; this doc is meant to force that decision, not presume it.

## 1. Problem statement

Two distinct problems are getting bundled together here, and they don't necessarily share a solution:

1. **Perception problem.** Rob controls the memo process and views Danny as "the community guy." The fix for that is making Danny's founder-read visible on paper — evidence-backed, not vibes-backed — to Brandon, Eric, and Rob.
2. **Operating problem.** After Permute failed (wrong data source, failed builds, broken app), Danny wants a reliable way to see pipeline/portfolio status without depending on a flaky third party.

A dashboard can help with #2 regardless. It only helps with #1 if it actually gets in front of the partnership and the content it shows is substantive. Those are two different bars to clear, and it's worth being honest that a dashboard is necessary for neither — it's one possible solution among several.

## 2. The honest case against building this

Raising these directly since Danny isn't convinced:

- **The data isn't there yet, and no dashboard fixes that.** Of the 166 founders currently in active diligence/deal stage, 0 have a `caliber_score`, 0 have an `ai_summary`, and only 4 have a completed `opportunity_assessments` record. Section 3 (Pipeline Highlights — the load-bearing section for the "not just the community guy" case) would render mostly empty right now. Building the presentation layer before the underlying evaluation work is done risks the opposite of the intended signal: Brandon sees a polished dashboard with blank fields, which reads as "process without substance," worse than no dashboard at all.
- **Distribution is unsolved, and it matters more than the dashboard.** A dashboard that lives behind a login inside Stu only works if Brandon habitually opens Stu. Does he? If not, this doesn't solve the perception problem no matter how good it is — it just becomes something Danny looks at alone. The mechanism that actually changes perception is more likely: what Danny brings into partner meetings and memos (which Brandon already sees), or something pushed to Brandon directly (email/Slack), not a new screen he has to remember to visit.
- **Build/maintenance cost isn't zero.** Stu is a solo-maintained, 26-table system with known fragility (SYSTEM_MAP.md flags a live FK-crash bug on fresh DBs, and a "no retry, no read-back" one-way sync to Airtable/Notion as "the central drift surface"). Every new surface added is more surface Danny alone has to keep working. This is a real cost against a fund partner's time, not a free instant win.
- **A cheaper alternative may get 80% of the value.** See Option B below — Stu already has a `daily_brief` / `newsletter` digest pipeline built and running. Extending that to include a partnership-facing pipeline/portfolio digest is a much smaller build than a new interactive dashboard, and it solves the distribution problem by design (it's pushed, not pulled).

**Bottom line up front:** don't greenlight the full dashboard build yet. Two prerequisites should resolve first — data completeness and distribution mechanism — because building this now optimizes the wrong bottleneck.

## 3. Two options, not one

### Option A — Full interactive dashboard, native to Stu
A new authenticated view in Stu's existing React client, backed by new aggregation routes in the Express server, covering the six sections below. Pull-based: Brandon (or Danny, presenting from it) has to open it.

### Option B — Partnership Digest, extending existing infra
Stu already has `daily_brief`, `daily_brief_log`, and `newsletter_items`/`newsletter_sources` tables and a working cron-driven brief pipeline (`PIPELINE_CRON` in `.env`). Extend that existing mechanism to generate a weekly (not daily — cadence matters less here than for newsletter content) **Partnership Digest**: same content as the dashboard sections below, formatted as a brief and emailed or Slacked directly to Brandon. Push-based: it shows up whether or not anyone remembers to log in.

Option B is very likely the better first move: smaller build (reuses an existing pipeline instead of standing up a new one), and it directly solves the distribution problem that Option A doesn't. Option A remains worth doing later, once the underlying content (Section 3 in particular) actually has substance to show, and could reuse most of the same aggregation logic Option B would require anyway.

## 4. Blocking prerequisites (apply to either option)

1. **Run the assessment/caliber pipeline against the active pipeline.** Before any version of this ships, the 166 active-stage founders need real `caliber_score`/`fit_score`/`opportunity_assessments` data, or the flagship section is empty. This is the actual leverage point, not the dashboard.
2. **Decide the distribution mechanism with Brandon, not for him.** Ask directly: does he want a weekly digest pushed to him, or would he rather review something live in a partner meeting? Building either option without that answer risks solving a problem he doesn't have.

## 5. Proposed content (shared by both options)

Adapted from the family-office philanthropy dashboard structure, mapped to Stu's actual schema:

| Section | Shows | Source (Stu tables) | Why it matters for the Brandon problem |
|---|---|---|---|
| **1. Summary strip** | What changed this week: new founders sourced, stage moves, decisions made | `founders` (status/stage changes), `sourcing_runs` | Proves cadence — the pipeline is moving, not stagnant |
| **2. Thesis coverage** | Deal count + quality by vertical (professional services, construction, healthcare, legal, financial services) | `founders.domain`, `founders.caliber_score`/`fit_score` grouped | Shows strategic sourcing, not just volume |
| **3. Pipeline highlights** | Per active deal: stage, vertical, and *why it's interesting* | `founders.fit_score_rationale`, `caliber_signals`, `ai_summary`, `notable_background` | **The core "not just the community guy" section** — Danny's judgment, written down, per deal |
| **4. Conversation insights** | Recent call summaries and key takeaways | `call_logs.structured_summary`, Granola sync | Shows diligence is systematic, not just good vibes from a coffee chat |
| **5. Upcoming** | Memos due, IC discussions pending, follow-ups with a deadline | `founders.memo_status`, `diligence_status`, `next_action` | Turns the artifact into a to-do list, not just a report |
| **6. Deliverable status** | Memo/diligence status per active deal, open portfolio Founder Asks | `founders.memo_status`/`diligence_status`, Airtable Founder Asks (if reconciled) | Shows full lifecycle ownership, origination through portfolio support |

## 6. Technical approach (if greenlit)

- **Option B (recommended first):** extend the existing daily-brief pipeline (`server/pipeline/`) with a new brief type, new aggregation queries against `founders`/`opportunity_assessments`/`call_logs`, and a new delivery template (email or Slack, reusing whatever channel the existing brief already uses). No new client UI required for v1.
- **Option A (later):** new Express route(s) for the six aggregations above, new client page in `client/`, reusing the same queries built for Option B. Meaningful but bounded — a few days of focused work, not a rebuild.
- Neither requires new external dependencies or accounts — everything runs on infrastructure Danny already owns and controls, which is the entire point after the Permute experience.

## 7. Success metrics

- Section 3 renders with real content for >80% of active-stage founders (proxy for "prerequisite 1 resolved")
- Brandon references something from the digest/dashboard unprompted in a partner conversation within the first month (proxy for "this actually changed the perception problem," not just "Danny built a nice internal tool")

## 8. Open questions for Danny

1. Has Brandon ever asked for something like this, or is this Danny inferring the need? Worth a direct gut-check before building either option.
2. Weekly cadence, or tied to partner meeting rhythm instead?
3. Is Section 3 worth blocking on — i.e., is Danny willing to spend the time running assessments against the 166 active founders before either option ships?

## 9. Recommendation

Don't build Option A yet. Resolve the two prerequisites first (assessment coverage, distribution decision with Brandon). If Option B (digest) is what's actually needed, it's a smaller build that reuses infrastructure already in Stu and solves the distribution problem by construction. Revisit Option A once Section 3 has real content and there's a confirmed reason Brandon would want a dashboard specifically, rather than a digest.
