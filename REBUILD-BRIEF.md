# Stu — Rebuild Brief

**For:** a fresh Claude Code session working on `~/Documents/Claude Workspace/superior-os/`
**Written:** 2026-07-15, at the end of a long session that got a lot right and several important things wrong.
**Read this whole file before writing a line of code.** Most of it is expensive, verified fact that took a day to establish. The rest is a list of my mistakes so you don't repeat them.

---

## 1. Who this is for

**Danny Goodman.** VC at **Strider Capital** (`danny@strider.capital`), a ~$10M Chicago pre-seed fund incubated out of Brandon Cruz's family office (Brandon founded GoHealth, took it public 2020). The brand/building/community is **Superior Studios** — an admission-only founder HQ in Brandon's building downtown.

- **His job:** he runs **sourcing and diligence** for the fund. He takes the first call. He triages: building resident, investment candidate, or both.
- **His goal, verbatim:** *"find and ultimately fund the most talented entrepreneurs in the world at the earliest stages (with a preference for those with Chicago or Illinois ties)."*
- **Checks:** $150–400K. **8 investments** in the last year, all pre-seed except one follow-on.
- **Volume:** ~**28 founder meetings per month** (verified from Granola). ~1/day.

**Density is NOT part of this product.** He grew it before Superior Studios. Do not build for it, do not reference it. At most it's a historical value in a Source field. *(I got this wrong repeatedly. Don't.)*

### The politics — this shapes the product

- **Rob Schinske** (senior associate) controls the memo process and has never asked for Danny's input. Views Danny as "the community guy."
- **Eric** is skeptical of Danny's analytical depth. Neither Rob nor Eric sources.
- **Brandon** is the final decision maker and sponsors Danny's builds.
- Danny keeps analytical work **private from the team** by rule.

Danny, verbatim: *"I don't bring anything to IC. It's really annoying... I should be the deal leader. So I need the info to be able to take on that role."*

And: *"It's way more efficient if I come in with conviction one way or the other before brokering the second meeting. I'd rather get one meeting with myself, Eric, Rob, and the founder — vs. one call with Rob who determines it's worth kicking up to Eric."*

**That is the product's job.** But do not build a weapon against Rob — that fight loses. Build the thing that makes Danny's view arrive first, dated, and hold up.

### His self-reported failure modes — design around these, they're load-bearing

- *"Most of the time, founders are building technically cool but relatively easy and **indefensible** things."* ← his most common kill. Defensibility should be early and fast.
- *"A lot of it is **neglect**."*
- *"Sometimes I just don't feel like following up... Like **I want to inflate my pipeline numbers**. Or **I'm waiting to think through if I believe in a company or not**."*
  → **Never build a pipeline-count metric.** He's told you he games it.
  → The blocker isn't discipline, it's an **unformed view**. Nagging treats the symptom.
- **Crebit** was lost because the round closed the week they met and Rob wouldn't move fast. **Latency kills deals.**
- Portfolio Pattern Analysis, his own note: *"you pass well on markets, poorly on documentation — and the gap is exactly on your best founders... you can't tell whether those were good passes or fear/laziness."* Most fixable blind spot.

---

## 2. The stack — Stu is ONE part of it, and not the smartest part

```
  AIRTABLE            STU                 OBSIDIAN            GRANOLA
  team's CRM          the surface         his brain           every call
  (shared)            (private)           (private)
  ──────────          ──────────          ──────────          ──────────
  deal status    →    where he works  →   memos, decisions    transcripts
  facts               state that changes  judgment            ~28/month
```

Plus **Claude Code scheduled tasks** (`~/.claude/scheduled-tasks/`) which are, right now, **the actual analyst**:

| Task | When | What |
|---|---|---|
| `founder-call-auto-workup` | daily 7:10pm | **Reads Granola → writes Call Notes + Founder Assessment + Market Deep Dive to the vault.** Real web research with cited URLs, a 4-lens investor panel, adversarial claim-testing, scores against the current Founder Rubric. |
| `rubric-auto-score` | every 30 min | Airtable Granola notes → scores → Airtable Steward-Operator fields |
| `stu-vault-sync` | daily 7:32pm | Stu assessments → vault |
| `thesis-board-daily` | daily 6pm | thesis tracker |

**CRITICAL, and it reframes everything:** `founder-call-auto-workup` **does the assessment better than Stu**. It has web access; Stu's agents do not. It runs a 4-lens investor panel; Stu doesn't. It cites URLs; Stu can't.

**So do not rebuild the brain.** Stu is the **surface** — the thing that holds *state that changes* (a commitment with a clock, a decision with a prediction, a pipeline stage). The vault holds documents. A document can say a promise was made; only Stu can say it's three days late. Danny, verbatim: *"Stu should be more the surface. I don't mean to replace what we have with Obsidian or recurring tasks."*

---

## 3. Verified facts you must not re-derive

### ⚠️ 2026-07-16 — I MADE THE LOCAL-DB MISTAKE AGAIN, WITH THIS WARNING ALREADY WRITTEN

I read the paragraph below, then measured `server/superior-os.db` anyway and reported the numbers to Danny as fact. They were wrong by an order of magnitude:

| | local said | prod actually |
|---|---|---|
| company LinkedIn URL | 2 | **25** |
| enriched | 1 | **25** |
| cards with a website read | 3 | **68** |
| cards with notes | — | **73** |

And it happened a THIRD time, subtler: I cited "LegalOS's website_url is a LinkedIn profile" as a live production fact in two library headers, two tests, and this brief. **There is no LegalOS card on production** — that row exists only in the local DB. The guard it justified is correct and the hazard is real (Permute's website_url is `scout.space`, a *different portfolio company*; Ampere's is the string `"N/A"`), but I had shipped a false citation into files whose whole value is being trustworthy. If you cite a row as live, fetch it from prod first.

**Do not measure the local DB. Ever.** Read prod with a locally-minted JWT — Railway shares the `.env` `JWT_SECRET`, so this works and is the fastest path in:

```js
jwt.sign({id:1,email:'danny.eric.goodman@gmail.com'}, process.env.JWT_SECRET, {expiresIn:'2h'})
// -> Authorization: Bearer <token> against https://www.stu.vc/api/...
```
`GET /api/pipeline` is the board; `GET /api/pipeline/:id` is one card with `enrichment` and `public_record` parsed. The vault-sync secret is **in the macOS Keychain**, not in any file: `security find-generic-password -s stu-vault-sync -w`.

### ⚠️ DO NOT SWEEP THE BOARD TO MEASURE IT
`/api` is rate limited to **200 requests / 15 min** (`index.js:386`). The board is 183 cards, so **one N+1 sweep of `/companies/:id/sources` nearly exhausts the window.** I did this repeatedly while a backfill and a subagent were running, and:
- 63 of 183 probes came back non-JSON and I counted the survivors as if they were the whole board — reporting "0 Granola notes" from a broken sample.
- I left a background watcher doing the same sweep **every 45 seconds**, which starved the very backfill agent I was waiting on. The agent's pushes were being 429'd and I was diagnosing it as a code problem.

Also: **the limit behaves per-instance.** A POST 429'd while a GET seconds later reported `ratelimit-remaining: 113` — consistent with multiple Railway replicas each holding their own in-memory `express-rate-limit` counter. So headroom is unreliable and **429 is normal**: pace requests and retry with backoff rather than treating it as failure. `429` returns plain text, not JSON — any bare `json.load()` on a response will throw.

There is no bulk read for per-card sources. If you need board-wide counts often, add one rather than sweeping.

### Production, measured 2026-07-16 AFTER this session's backfills
- **183 live cards** · 76 with a website · 68 with the site read · 73 with notes
- **44 enriched** (was 25) · 42 with a roster + growth curve · **276 people on cards**
- **142 with a public record** · **9 with a real Form D**
- **0 cards with open roles** — see the hiring note in §4c
- EnrichLayer: **961 credits left** (596 spent on the backfill, ~$7.60)

**PRODUCTION HAS ITS OWN DATABASE.** `server/superior-os.db` on the laptop is a **stale snapshot**. I audited it for two days and every row count I reported was wrong.
- Prod: **40 assessments across 9 companies**. Local: 18 across 6.
- `db.js:5` — `process.env.DATABASE_PATH || path.join(__dirname,'superior-os.db')`. Railway persists only `/data`. April data survived several deploys, so `DATABASE_PATH` is *probably* set — **but verify** (`railway variables | grep DATABASE_PATH`). If it isn't set, prod's DB is on ephemeral disk. `seedIfEmpty()` and `syncFromAirtable()` re-populate `founders` on every boot, so founder counts would look healthy on a wiped disk. **Assessments are never re-seeded — they're the canary.**
- **To read prod:** `GET https://www.stu.vc/api/vault-sync/assessments` with header `x-vault-sync-secret: $VAULT_SYNC_SECRET`. The secret is in Railway. **Danny pasted it into a chat log — tell him to rotate it.**

**The database column names lie.** `founder_agent_output`→Team, `market_agent_output`→**Product**, `economics_agent_output`→**Market**, `pattern_agent_output`→always NULL. A scar from a retired 6-agent schema. `routes/memos.js` and `services/notion-assessment-sync.js` were both mislabeling product as market; both fixed.

**Granola is reachable** via MCP (`mcp__57903282-...`). 28 meetings in 30 days. A single natural-language query extracted **~28 commitments across 14 meetings** in 60 seconds.

**The sourcing engine has never run.** Both `sourcing_runs` rows show `founders_added: 0` and ~100 identical errors: `"No EXA_API_KEY configured"`. 1,842 lines fanned out 100 Exa queries against a key that didn't exist. **The key exists now** (`user_settings`, BYOK). `PIPELINE_ENABLED=false` in local `.env`; it's `true` in Railway.

**The sourcing inbox already exists.** `GET /api/sourcing/queue` + `POST /approve/:id` `/dismiss/:id` `/hide-forever/:id` `/starred`. Danny remembers it because it's built. It's empty, not missing.

**~22 of 34 local tables have zero rows.** Newsletter, monitors, deal room, chat, MCP tokens, thesis notes, entity filings — all built, none used. Newsletter/monitors/MCP were built in **June** and have never produced a row. **Danny approved deleting newsletter, monitors, chat. He wants the changelog kept.**

**Stu is BYOK multi-tenant by design.** Danny: *"Stu is just me for right now, but it is setup for others... they need to upload their own keys. I don't want to be paying for other people's work."* **Keep auth, onboarding, settings, BYOK, Landing. Drop only Stripe/payments** (routes already commented out).

**`HARMONIC_API_KEY`, `CLEARBIT_API_KEY`, `CRUNCHBASE_API_KEY` are in `.env` and no code calls them.** The Crunchbase one is a friend's account. Danny should pull them.

**They are also all EMPTY STRINGS** (verified 2026-07-16 — `key len: 0`). They were never going to work. The real keys live per-user in `user_settings` (`api_key_exa`, `api_key_enrichlayer`) via `lib/providerKeys.js` — that's the BYOK design, not a bug. **Crunchbase v4 needs a paid enterprise license; a friend's *account* is a web login, not an API key.** Do not build on it. Use SEC EDGAR (`lib/edgar.js`) — free, no key, and at pre-seed it is *earlier* than Crunchbase because Form D is filed within 15 days of first sale while the press release comes whenever the founder feels like it.

**EnrichLayer is alive** (Proxycurl's successor — LinkedIn sued Nubela and Proxycurl shut down July 2025, so check this assumption if enrichment ever dies). Verified 2026-07-16: real data, 961 credits. **Its `/api/v2/company/resolve?company_domain=X` endpoint is the single highest-leverage call in the stack** — ~1.3 credits, returns the LinkedIn company page from a domain, and works on 4-person companies the name-search resolver refuses to guess at.

---

## 4. What was built in the last session (all deployed, all tested)

Branch `feat/conviction-engine`, merged to `main`, live at **www.stu.vc**. **220 tests passing** (`cd server && npm test`).

### The conviction engine — `server/lib/conviction.js`
The best thing in the codebase. **Don't erode it.**
- Scores the **Founder Rubric**'s 4 movements → a Conviction Score 1–10 → 4 bands (Anchor-grade / Top-quartile / Monitor / Pass with respect). Those band names are **Danny's** — they're already in his Airtable.
- **Gate, not compensator.** Earned Insight + Execution & Learning Velocity SET the score; Nonconsensus Vision + Talent Magnetism move it ±1. A flat weighted mean *inverted the rubric* — enumerating all 10,000 integer combos, `10,10,1,1` scored 6.4 "Monitor" while `5,5,10,10` scored 7.0 "write a memo".
- **Evidence rung gate.** Computed in code from the inputs, never by the model. Below "observed in conversation" there is **no score** — there's a question list. A URL-only run must never look like a Pass.
- **Never clamps a bad score.** An out-of-range value is a *system fault*, reported as one.
- **Personal Conviction is never computed.** It's Danny's go/no-go.
- Ships a calibration caveat with every result (n=9, no outcome loop).

### Fixed, all verified against real data
- **No temperature was ever set** → every scoring agent ran at 1.0. Six founders assessed twice on byte-identical inputs moved up to 1.1 points. **Stu was sampling its own verdicts.** Now `SCORING_TEMPERATURE = 0`. ⚠️ Sonnet 5 / Opus 4.7+ **reject** non-default temperature with a 400 — any model bump breaks every agent.
- `(teamScore || 0) * 0.45` → a crashed agent scored 0 and flipped the verdict to "Pass" while the UI hid the card. Infrastructure failure and negative judgment rendered identically.
- A `MANDATORY SCORING RULE` forced product 8s off a *slide claim*; those 8s tripped a ceiling that **muzzled the Bear**. A deck could talk itself into an Invest, silencing the one agent built to catch it. Both deleted.
- Every scoring prompt was **anchored on one agent-payments deal** (Placer.ai, "Equifax for AI agents", Visa/OpenAI, Stripe Radar) — in a fund whose thesis is explicitly *not* tech-to-tech.
- `verify.js` tagged `"we lost four customers"` as amber "Paraphrased" — bag-of-words over a 150K corpus always matches. Now adjacency-based + flags invented numbers.
- **`max_tokens` was 4096** → the Bear truncated at exactly 4096 and "failed" to parse. 8192 now. This predated the rebuild; temperature 1.0 made it *intermittent*, so it read as flakiness.
- **Retry storm:** SDK retried 2× *and* the wrapper retried 3× = up to 6 requests × 5 agents. `maxRetries: 0` on the SDK now.
- The rubric agent now runs **first, alone**, then the depth 4 fan out — it was timing out competing with agents whose output is only commentary.
- `rubric-auto-score` was scoring the **retired 9-trait rubric** into the Airtable fields Danny's team reads, **every 30 minutes**. Repointed at `Brain/02 Frameworks/Founder Rubric.md`.

### New — `commitments`, `today_items`, `decisions` tables
- **Commitments** (`server/lib/commitments.js`, `routes/today.js`): who owes what, **verbatim quote required** (NOT NULL — a paraphrase of a promise is exactly the thing that can be performed), stated date, due date, source transcript. Idempotent via `dedupe_key`.
- **The write path:** `POST /api/vault-sync/commitments` — owner-only, secret-gated, one table, idempotent. **`founder-call-auto-workup` now pushes commitments here.** This is how the Listener works without a Granola webhook (Granola has none; a native integration was priced at 4–6 days and may be impossible).
- **Decisions:** band + rationale + **a dated falsifiable prediction (required)** + `resolve_by`. Captures what Stu said, so disagreement becomes a calibration set.

### The live proof
Ran the new engine on **Cadrian AI** (Dan Preiss, a real live deal) with the real deck + the real Granola transcript: **6.2 / Monitor**, charisma-over-substance flag fired with evidence — *"zero ARR, zero named customers, no data room, at a $15M post... Preiss is a former VC who knows how to pitch."* 12/12 quotes verbatim. The old engine said "Monitor" too — but because **29 of 40 assessments were Monitor (72%)**. The instrument had one answer.

---

## 4b-bis. ⚠️ GRANOLA OVER-RECORDS — this is a privacy hazard, not a data-quality one

Found 2026-07-16 while backfilling transcripts. One Granola note ("Ayush", 2026-04-20) kept recording long after the call ended: roughly half the transcript is ambient household audio — a third party's medical details, a family member's unannounced resignation, childcare conversation. None of it is meeting content, and none of it is Danny's to hold in a deal tool.

**It did not reach Stu**, and only by luck of design: no card matched the title, and `resolveFounderId` refuses rather than guesses, so `ingestGranolaNote` was never called. Had the title matched a founder card, the whole thing would have been stored and fed to the signal extractor.

Two consequences for anything that pipes Granola into Stu:
1. **Never "fix" a transcript by trimming it.** Silently editing source text is the exact laundering the verbatim-quote rule exists to prevent. If a transcript is wrong to store, it should be deleted at the source in Granola — not cleaned up in transit.
2. **The refusal rule is load-bearing beyond attribution.** It was written to stop a transcript landing on the wrong card; it also happens to be the only thing standing between an over-recorded personal conversation and a permanent, indexed, quote-extracted record. Do not loosen it.

Danny should check Granola's auto-stop setting. This is a source-side problem and only he can fix it.

## 4c. Session 2026-07-16 — what shipped, and what it's actually worth

All deployed to prod. **451 tests passing.**

### Shipped
| What | File | Verdict |
|---|---|---|
| **Domain → LinkedIn resolver** | `lib/resolve-company-linkedin.js` | **The big one.** Name-search resolved 0/93 on prod; the domain path resolved 20. Enrichment 25 → 44 cards. |
| **SEC Form D reader** | `lib/edgar.js` | Free, no key. 9 real raises found (Scout Space $10.9M, responsiv $3.0M, ClearCOGS $1.9M, Auvi $101K…). |
| **Hiring / open roles** | `lib/hiring.js` | Correct and **yields 0 of 183.** See below. |
| **Granola → cards** | `routes/vaultSync.js` | Matcher rewritten; server now parses meeting titles. |
| **Auto-read website on save** | `routes/pipeline.js` | Paste a URL, the card reads it. |
| **Sources analyse themselves** | `lib/extract-signals.js` | `extractSoon()` on every ingest path. |
| **Create / delete cards** | `routes/pipeline.js` + `Pipeline.jsx` | Composer + soft delete + undo. |

### Honest verdicts — do not oversell these to Danny
- **Hiring found 0 open roles across the entire book**, and that is not a bug. Pre-seed companies don't run an ATS, and their careers pages are client-rendered. 17 cards have a careers page we found and can't parse (`bolto.com/careers` is real, 613 words, roles in the HTML, no ATS). The module will start paying as his companies grow. **It never says "not hiring"** — no board found means unknown, which is the truth.
- **Form D at pre-seed is ~5% coverage** (9 of 183). Real, free, and permanently low-recall — most pre-seed rounds are SAFEs that file no Form D or file late. Its edge is *latency*, not coverage: the filing lands within 15 days of first sale, months before any press.
- **The remaining 48 unresolvable cards are legitimate refusals**: 12 stealth (no company to resolve), 21 one-word names with no website on the card. The fix is data, not code — **put a website on the card and the domain resolver does the rest.**

### The competitive read (researched 2026-07-16, sources in the session log)
- **Harmonic's public OpenAPI spec is unauthenticated**: `https://api.harmonic.ai/openapi.json`. 224 schemas. Read it rather than their marketing.
- Their `FundingAttributeNullStatus` distinguishes `EXISTS_BUT_UNDISCLOSED` from `NONE_ANNOUNCED`. **Steal this.** At pre-seed most fields are empty, so the null taxonomy IS the product: *unknown* / *known-absent* / *known-but-undisclosed* / *asked-and-founder-declined*. That last one only exists if you have transcripts.
- Harmonic has ~100 **person**-level highlight categories and only 5 company-level. At pre-seed a company IS its people.
- **Proxycurl was sued by LinkedIn and shut down July 2025.** The LinkedIn headcount panel every one of these tools rests on has no cheap legal source anymore. That asymmetry is why they cost $25K+/yr.
- **The whole category treats a meeting as a timestamp.** Attio's entire interaction record is `{interaction_type, interacted_at, owner_actor}` — not what was said. Affinity's transcripts API is Enterprise-gated beta. **Danny's ~28 transcripts/month are the one asset none of them can buy.** Harmonic's answer to pre-seed is `founder_story` — *a form they beg the founder to fill in*. Danny gets that unprompted, dated, with follow-up questions attached.

## 4b. ⚠️ THE BIGGEST GAP — read this before anything else

**Danny, at the end of the session:** *"So are the insights and notes from Granola, which I guess are also in Obsidian, also now in company cards? I'm not seeing the info and insights displayed in cards."*

**No. And he's identified the most important problem in the product.**

| | Companies | Content |
|---|---|---|
| **Vault** `Brain/08 Deals & Memos/` | **25** | Call Notes · First-Pitch Brief · Founder Assessment · Market Deep Dive — written nightly by `founder-call-auto-workup`, with cited web research and a 4-lens investor panel |
| **Stu** (production) | **9** | agent JSON, mostly one batch from April |

**The vault knows ~3× more companies than Stu, with far richer content, and Stu cannot see any of it.** The only thing that has ever flowed Granola → Stu is *commitments*, and only Cadrian's, because I pushed them by hand with curl.

**And there is no company card.** Stu has Today (lanes), Pipeline (the old founders CRM), and an assessment detail page. Nothing that says *"here is everything we know about this company."* Danny is looking for something that does not exist.

**Why it happened:** I said "Obsidian is the brain, Stu is the surface" — and never connected them. **A surface over a brain it can't read is just a different empty room.** The insights are markdown on his laptop; Stu runs on Railway and cannot reach his filesystem. So Stu can never *pull*. The task must **push**.

**The fix, and it's ~an hour:** `POST /api/vault-sync/workup`, alongside the `/commitments` endpoint that already works (`routes/vaultSync.js`). `founder-call-auto-workup` already writes the workup — teach it to POST the same content. Then a company card has something to show: call notes, the assessment, the market read, the commitments, the decision — one page, one company, sourced from the task that already does the analysis well.

**Do this before any redesign.** A beautifully designed card with nothing in it is the current problem with extra steps.

---

## 5. What is WRONG right now — Danny's words

> *"I hate the design and functionality right now."*

> *"This rebuild is not going well."*

**My biggest mistake: I built a "Today" screen he never asked for and made it the front door.** He asked five times for *"my personal Affinity/Harmonic — sourcing, tracking, assessing."* Today should be **filters on Pipeline**, not a destination. The commitments engine underneath it is good and should stay.

**The design is stock Tailwind and reads as unfinished.** Verified against the shipped CSS of Linear/Attio/Monaco/Granola: `#3b82f6` and `gray-500` are the uniform of unfinished software. I also centered everything in a `max-w-3xl` — centered content in a wide frame is the strongest "empty" signal there is.

**Nothing is connected.** `sourced_founders`, `founders`, and `opportunity_assessments` are three tables that don't know about each other. Approve someone from Discover and they *become a different record*.

**There is nowhere for Danny's own thoughts.** He said "add my own thoughts elegantly." There is literally no field. Biggest functional gap in the product.

---

## 6. What to build

### The structural insight
**Stu has ONE object — a company — and four screens pretending it has four.** Sourcing / Pipeline / Assessing are **stages of one thing moving**: `found → met → assessed → decided → memo`. That's why nothing connects. Affinity and Attio both solved this with one record substrate and *views* over it.

**Two destinations:**
- **Pipeline** — the product. Sourcing is its **inbox**. Assess is its **detail page**.
- **Talent** — genuinely separate. Different people, inverted lens, different customer (his founders).

### 1 — Sourcing
An **inbox that fills overnight**, not a search box you operate. Discover today makes him pick signals and hit run; Harmonic's own lesson is that *the alert is the product and the search bar is its config UI*.
- **First: run the engine once.** It has never run. Free connectors (`pipeline/sources/`: yc-directory, a16z-speedrun, cohort-rosters, il-school-discovery, pre-program-discovery, uspto-trademark) + github-activity + SEC Form D need **no Exa**. Read what comes out, then decide if it's worth keeping. *Danny's own note says "structured directory > web-search" for reliability — the Radar failed because it routed everything through Exa.*
- Triage from the inbox → the company enters Pipeline. **Same record.**

### 2 — Pipeline (the front door)
One dense table. Every opportunity. Connected to its calls, commitments, assessment, and decision.
- Columns that earn their place: **Company · Stage · Who knows them · Last contact · Signal (a delta or a clock) · Read (band)**.
- `Who knows them` is Affinity's entire $2,000/user/year product in one column.
- Geo lens: Chicago/IL default, **one toggle to the whole board** (Brandon will ask).
- **Pre-founders are first-class** — a person with no company. Danny is building pipelines of local students who'll found later. Name, LinkedIn (verifiable via Proxycurl), notes, a clock.
- **Source is a chain, not a dropdown.** Airtable records the last hop, which is why outbound looks like it produces nothing when it's actually how he fills the top of the funnel. Record: *how I found them → how they entered → what converted them.*

### 3 — Assess
The engine is done. The **page** needs rebuilding: 1,500 lines of tabs → one page.
- **Danny's own thoughts need a real home.** Proposed: two columns that never merge — `THE READ` (Stu, evidence-cited, every claim traceable to a verbatim line on hover) and `YOUR CALL` (Danny's, free text + his own band). Stu never originates a claim in his column; it may transcribe while he talks. **Enter his call blind, before Stu's read unlocks** — otherwise it's priming, not calibration.
- **Defensibility goes near the top** — "cool but indefensible" is his most common kill and it's readable from a deck before he's spent a meeting.
- When they disagree, the gap + a dated checkable claim **is** the artifact. That's the only dataset here that compounds: *"when Stu and I disagreed, who was right?"*

### 4 — Talent
> *"Imagine an outsourced founding team member recruiter."* A founder texts him — *"know anyone who could be a founding engineer?"* — usually with no JD. **The job is finding candidates, not opening doors.** The deliverable is **a shortlist he can forward, with a line on each and a reason they'd say yes.** Not a database view.

- **Same signal layer as Sourcing, opposite lens.** The person who just left Stripe and registered a domain is the *best* sourcing target and the *worst* hire. Same data, inverted scoring.
- The Avant Health JD (Oct 2025, full-stack engineer, in `08 Deals & Memos` context) wants *Learning Velocity, Judgment Under Uncertainty, Systems Awareness, Initiative* — **that's the Founder Rubric.** Founding-team hires get scored on founder traits, plus two things sourcing never needs: **availability** and **will they say yes**.
- The existing Talent wing is ~4,200 lines and 10 pages for one req, frozen since April. **Danny said rebuild it so it actually works.**

---

## 7. Design system — implement this, don't invent

Verified by grepping the shipped CSS of Linear, Attio, Monaco, Granola.

```js
// tailwind.config
fontSize: {
  micro:   ['11px', { lineHeight: '16px' }],   // section labels, uppercase, tracked
  mini:    ['12px', { lineHeight: '16px', letterSpacing: '-0.01em' }],  // metadata
  small:   ['13px', { lineHeight: '20px', letterSpacing: '-0.013em' }], // row titles
  regular: ['15px', { lineHeight: '24px', letterSpacing: '-0.011em' }],
  large:   ['18px', { lineHeight: '28px', letterSpacing: '-0.015em' }],
},
// Linear's real weights — variable-font optical corrections, and a big part of why
// they don't look like a Tailwind default.
fontWeight: { normal:'400', medium:'510', semibold:'590', bold:'680' },
spacing:    { px:'1px', 0.5:'2px', 1:'4px', 2:'8px', 3:'12px', 4:'16px', 6:'24px', 8:'32px' },
borderRadius:{ sm:'4px', DEFAULT:'6px', md:'8px', lg:'12px' },  // never 16px in dense UI
transitionDuration: { fast:'100ms', DEFAULT:'150ms', slow:'250ms' },
```

**The five rules:**
1. **One primary ink per row.** The company name is dark; everything else recedes. If two things compete you've failed.
2. **Solid greys, never opacity, for text.** Linear does *not* fade text — it ships a discrete ramp. Alpha is only for hover fills and hairlines. (The "40–60% opacity" folklore is wrong; I checked the CSS.)
3. **Hairlines + a background ladder, never shadows.** Linear has zero drop shadows. Attio ships four stroke weights. Border hierarchy does the work spacing was failing to do.
4. **Color means state, never decoration.** One accent hue. Red only for destructive. **Urgency = promoting text up the ink ramp, not adding hue.**
5. **AI recedes; provenance on hover.** Granola: machine text grey, *your* text black, no badge, no italics, no sparkle. NN/G tested ✨ on 107 people — **zero** said it meant AI. For an investor tool the AI is the substrate, not a feature.

**Density:** ~**32px rows**, 8px cell padding, 1px separators, **full-bleed**. ~24 rows on a 900px screen. **Never center content in a wide frame.** Whitespace at the edges reads as absence; whitespace between dense elements reads as calm.

**Motion:** hover-in **0ms**, fade-out 150ms (Linear ships exactly this). Easing `cubic-bezier(.2,0,0,1)`.

**Keyboard:** Cmd+K navigates *and acts*, with the shortcut shown next to each command so the palette teaches its own map (Superhuman). Single unmodified keys for the 5–10 highest-frequency verbs.

**No blank states.** Day one it should already be full — pipeline imported, commitments backfilled from Granola, the scout run overnight. Monaco's best line: *"We set up your TAM, score your accounts, overlay signals, and import pipeline **on day 1**."*

⚠️ **Caveat:** 32px is inferred, not measured — every one of these apps is login-walled. Danny has Affinity access; screenshot a real list and measure before committing.

---

## 8. Hard constraints — Danny set these, do not negotiate them

Agents **may**: read transcripts, score, log commitments, update Stu, draft content, nudge Danny.

Agents **may never**:
- **Write to Airtable.** His team sees it.
- **Send anything externally.** He owns every send. Draft it; he presses send.
- **Email a founder** for something they owe him. *"Just nudge me to follow up."*

Other rules:
- **Never a pipeline-count metric.** He games it. The metric is **decided**, and the increment is *decision + a dated falsifiable prediction* — because a bare `pass = +1` would pay him to fire his ten-second "indefensible" reflex faster, and his undocumented passes on **strong** founders are his most fixable blind spot.
- **Passing must be cheap and kind.** He sits on no's because they're emotionally expensive. Auto-draft the "Pass with respect" note; he presses send. A no that takes 20 seconds gets sent; one that takes 20 minutes rots for three weeks.
- The vault is the source for frameworks. **Stu hardcodes copies of the rubric in `prompts.js` — that's why it spent a month on a retired rubric.** Read from the vault.

---

## 9. Traps — priced by an engineering review, all disguised as features

| Trap | Real cost | Why |
|---|---|---|
| **`companies`/`people` migration** | **10–15 days** | 5,513 founder rows, **2,937 with no company at all**, 1,841 fuzzy company strings. Dedupe is a fuzzy-match project, not a `GROUP BY`. `db.js` `addColumn` is `try{ALTER}catch{}` — it swallows every error, so a failed migration is indistinguishable from a success. No framework, no down-migration, no schema version. **Rollback = `cp` the SQLite file first.** |
| **Claim→line anchoring** | **6–8 days** | `verify.js` classifies *quotes* and discards position by construction (it builds Sets). No offsets in the schema. And a *claim* is a synthesis over several turns — there's no single line. **Honest version: every claim carries 1–3 supporting quotes, each anchored to a char span.** Don't promise universal anchoring. |
| **A native Granola trigger** | **4–6 days, may be impossible** | No webhook. The MCP is the *assistant's*, not the server's. **Already solved** — `founder-call-auto-workup` pushes to `POST /api/vault-sync/commitments`. Don't rebuild it. |
| **A 3-minute SLA on a "read"** | conceptually wrong | The rubric's own core question is about *"the next 18 months of learning."* Three minutes after a call is the maximum-charm, maximum-snapshot moment, and blind spot D says *"when you know the founder from the building, the rubric relaxes."* A fast read is a proximity discount with a UI. **Fast triage + a question list, yes. A fast verdict, no.** |

**Also unfixed:** no durable job queue. `runManager` is an in-memory Map; a redeploy strands runs at `status='running'` forever and the client polls for them indefinitely. There's no stale-run reaper.

---

## 10. What I got wrong — don't repeat these

1. **I built before I understood.** I shipped a "Today" screen he never asked for and made it the front door. He'd said "Affinity/Harmonic — sourcing, tracking, assessing" five times.
2. **I audited the wrong database** for two days and quoted confident numbers off a stale local file.
3. **I over-collapsed three times** — proposed deleting sourcing, then Talent, then merging Sourcing and Talent. All three were wrong. **He is the domain expert; ask before cutting.**
4. **I kept referencing Density** after being told twice it isn't part of this.
5. **I inherited a claim without checking it** — told him the tool "ranked the company you passed on above the two you backed." He hadn't passed; the founder paused his own raise. **Verify before building rhetoric on a fact.**
6. **I asked for his password** instead of minting a local dev token. (To see the UI: `jwt.sign({id:1,...}, process.env.JWT_SECRET)`, then `localStorage.setItem('stu_token', …)`. One line.)
7. **The screen caught bugs 213 passing tests didn't** — nine identical rows, "Dan Preiss" rendered as a company, "YOURS 1" with zero items, an add box that silently ate what you typed. **Render the page and click the thing.**

---

## 11. Where things are

- **Repo:** `~/Documents/Claude Workspace/superior-os/` · branch `feat/conviction-engine` (merged to `main`)
- **Deploy:** push `main` → Railway builds from `Dockerfile` → **www.stu.vc** (the apex `stu.vc` has no TLS; use `www`)
- **Tests:** `cd server && npm test` → 220 passing
- **Vault:** `~/Documents/Claude Workspace/Brain/` — start at `Start Here.md`
  - `02 Frameworks/Founder Rubric.md` ← **canonical**
  - `02 Frameworks/Superior First Call — Question Bank.md` ← his actual call script. **Q10 is his self-declared best signal** *("the delta between what they said and what they did... the one thing they can't perform")* and had **never been recorded once** before this session.
  - `04 Fund & Systems/Portfolio Pattern Analysis — 2026-06.md` ← 58 real decisions, named blind spots. Read this.
  - `04 Fund & Systems/IC Prep — Backing the Best of the Best.md` ← the politics, and *"'best of the best' = the best we can be first to."*
  - `04 Fund & Systems/Superior OS — The Workbench Rebuild.md` ← my long proposal. **Partly superseded** — ignore the Density sections and the Today-as-front-door framing.
- **Airtable:** base `appfE9DVrSUOrkkpu`, table `tblWkJzy5qpw7FP2M`. **Read-only from Stu's perspective.** Its front door is *admissions* (desks, evaluators, onboarding agreements); investment is a checkbox off the side. `Founder Asks` is a working action board — the pattern Danny already validated.
- **Scheduled tasks:** `~/.claude/scheduled-tasks/*/SKILL.md`

---

## 12. Suggested order

0. **Verify `DATABASE_PATH` + the Railway volume.** Nothing else matters if prod data isn't persistent. `cp` the DB before any migration. *(Also: `VAULT_SYNC_SECRET` was rotated on 2026-07-15 — get the current value from Railway.)*
1. **⚠️ Connect the vault to Stu (§4b).** `POST /api/vault-sync/workup`. Stu has 9 companies of April JSON; the vault has 25 with real analysis. **Everything below is decoration until Stu can see what the nightly task already knows.** ~1 hour.
2. **Run the scout once, free connectors only.** It has never run. Read the output. This decides whether sourcing is real — an afternoon, not a project.
3. **The design system.** Ink ramp, weights, 32px rows, full-bleed, hairlines. Everything is built on it, so it goes early. Measure a real Affinity row before committing to 32px.
4. **Pipeline as the front door**, with a real **company card** — the thing Danny asked for and can't find. One record: call notes, assessment, market read, commitments, decision. Today's lanes become filters.
5. **The Assess page.** Two columns. *Danny's thoughts get a real home.* Blind-first.
6. **Talent.** Same engine, flipped lens, shortlist out.

**Before writing code, confirm with Danny that Pipeline is the front door.** I guessed wrong twice; don't make it three.

---

## 13. The one-line brief

**Stu is Danny's private workbench between the team's Airtable and his own Obsidian: it sources founders into an inbox, tracks them through one connected pipeline, helps him form a dated view good enough to walk into IC as the deal leader, and helps his portfolio founders hire. The nightly Claude tasks are the analyst. Stu is the surface — the only thing that holds state with a clock on it.**
