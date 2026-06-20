# Talent MCP + Signal Monitors — Implementation Plan

**Author:** Danny (with Claude)
**Date:** 2026-06-19
**Status:** Phases 1–4 + Elite upgrade **BUILT & VERIFIED** 2026-06-19

> **Elite upgrade shipped (2026-06-19).** (1) **Analyst-grade enrichment** (`server/pipeline/enrichment.js`): discovery/search results come back ranked with a 0-100 unicorn score, a 1-line "why", and a trajectory summary (one Claude call, the user's key, graceful deterministic fallback if no key). Stored in new `unicorn_score`/`enrichment` columns on both tables (distinct from caliber 1-10 / talent role-fit). (2) **Outreach drafting** (`server/pipeline/outreach.js`, MCP `draft_outreach`, `POST /api/outreach/draft`): find → personalized message (recruit/invest/connect). (3) **`enrich_profile`** MCP tool — deep-dive one saved person. (4) **Parallel discovery** (queries fan out via Promise.all). (5) **Discover web page** (`client/src/pages/Discover.jsx`, nav + route): signal chips, Founders/Talent toggle, ranked result cards with score badge + why + signal pills + one-click "Draft outreach" drawer, no-key nudge. Verified: 78 unit + 31-check integration (enrichment scoring/ranking/why, enriched discovery + persisted score, outreach drafting, graceful no-key) all green; client builds; routes auth-gated. Discover page is build-verified (full authed visual preview pending).

> **Phase 4 shipped (active discovery — the "empty shelf" fix).** A new user (or empty account) can now ask "find me YC founders who just left" and get fresh people in seconds. `server/pipeline/discovery-engine.js` builds signal-driven web queries (Exa, `category: people`), extracts profiles, runs the deterministic signal detectors (so no LLM cost — Exa-only), and persists matches into the user's account. Exposed as MCP tool `discover_builders`, REST `POST /api/discover`, and an **active monitor** mode (`config.active=true` → the monitor goes and finds new departures daily). BYOK + spend-capped (Exa cost metered via `recordCost`); no key → a clear actionable error; empty local searches return a hint pointing to discovery. New-user surface updated: `/api/mcp/info` `quickStart` prompts, Settings "Try these from your agent" card, docs lead with discovery. Verified: 78 unit + 25-check integration (incl. 6 discovery checks with a mocked Exa — finds/persists/dedups, no-key error, noise filtering, empty-state hint) all green; client builds; boots.

> **Phases 2–3 shipped (2026-06-19).** MCP server live at `POST /mcp` (stateless Streamable HTTP, `@modelcontextprotocol/sdk`), Bearer-token auth via `mcp_tokens` (issue/revoke at `/api/mcp/tokens`), scope-gated tools that reach only the caller's own Talent/Sourcing data — never the owner's founder pipeline. The **unicorn-builder signal taxonomy** (`server/lib/builderSignals.js`, 7 types incl. `just_departed` with YC/factory tiers) powers MCP search, REST search (`/api/sourcing/queue`, `/api/talent/candidates` `?signals=`), and the **monitor engine** (`server/pipeline/monitor-engine.js` + `/api/monitors`, daily 7am cron). New-user surface: `GET /api/mcp/info`, a Settings "API & MCP Access" tab, and `docs/USING-STU.md` + `docs/mcp-quickstart.md`. Verified: 77 unit tests + a 19-check live MCP-client integration test (handshake, signal filtering, scope gating, auth, monitor create/run/dedup, encryption) all green; client builds; full server boots. Deep QA pass fixed a critical encryption↔newsletter regression, a monitor cross-run dedup bug, REST/MCP filter-validation parity, and removed dead code.

> **Phase 1 shipped.** Central key resolver (`server/lib/providerKeys.js`) + encryption at rest (`server/lib/secrets.js`) now own all metered key resolution. Every Anthropic call site (`ai`, `calls`, `memos`, `stu`, `assessments`, `import`, sourcing + talent engines, newsletter, email-digest, health) routes through it. Non-owner usage bills the user's own key or is refused — never the platform key. Stored credentials are AES-256-GCM encrypted and redacted from API responses. Soft daily spend caps protect users (owner uncapped). New tables: `usage_events`, `mcp_tokens`, `monitors`, `monitor_hits`. Verified: 70/70 existing tests pass, full server boots, cost-shift + encryption + cap assertions all green. Also fixed a pre-existing fresh-DB crash (`migration_flags` was read before creation). **Known follow-up:** the `danny_criteria_v1`/`talent_criteria_v1` seeds in `db.js` insert `user_settings` for `user_id=1` before `auth.seedTeam()` creates that user — FK-fails on a truly fresh DB (dormant in prod; must fix before onboarding a second tenant).
**Scope:** Expose Stu's Talent search to an external founder via MCP, ship a "YC founder just left" alert monitor, and generalize to a family of high-signal talent monitors — under two hard constraints:

1. **Cost shifts to the user.** Anyone who isn't Danny pays for their own metered usage (LLM + data APIs). Danny only pays when Danny uses the product.
2. **User safety is protected.** Auth, data-scoping, secret handling, PII minimization, spend caps, and prompt-injection boundaries are all enforced server-side.

---

## 0. Current state (verified against the codebase)

What already exists and works in our favor:

| Capability | Where | Notes |
|---|---|---|
| Multi-tenant data model | `server/db.js` | `users` table; `user_id` / `created_by` FKs on `sourced_founders`, `talent_*`, settings. Most queries already filter by `req.user.id`. |
| JWT auth | `server/auth.js` | `requireAuth` middleware, 7-day tokens. Single seeded user today (Danny, id=1). |
| Per-user key storage | `user_settings` table; `settings.js:119` | Keys stored under `setting_key='api_key_anthropic'`. |
| **The exact cost-shift rule, already written** | `settings.js:142–166` (`/test-anthropic`) | Resolves *"stored user key, else env key only if `req.user.id === 1`"*. This is precisely constraint #1 — but it lives only in the test endpoint. |
| Payments scaffolding | `users.has_paid`, `users.stripe_customer_id`; `/api/payments/webhook` | Billing hooks exist if we ever want metered-pay instead of BYOK. |
| Talent feature | `server/routes/talent/*` (portfolio, roles, candidates, matches, criteria, sourcing, trash); `server/pipeline/talent-engine.js` | The product the founder wants to use. |
| Departure signal, partially modeled | `sourced_founders.departure_recency_months`, `.signal_captured_at`, `.do_not_resurface` | The "just left" concept is already in the schema. |
| Entity/formation filings | `entity_filings` table; `server/pipeline/filings-source.js` | SEC Form D + IL SOS — reusable for a formation-signal monitor. |
| Scheduled-job pattern | `node-cron` in `server/index.js:291–383` | Existing daily crons for sourcing/talent/filings/newsletter. |
| Rate limiting | `server/index.js:222–230` | 200/15min on `/api`, 50/15min on `/api/ai`. |

The critical gap:

> **`getAnthropicClient()` (ai.js:5–14, and the equivalent in `pipeline/sourcing-engine.js` + `pipeline/talent-engine.js`) reads only `process.env.ANTHROPIC_API_KEY`.** Every user's LLM call currently bills Danny's key. The same is true for `EXA_API_KEY` and `GITHUB_TOKEN` (the metered *data* costs). Closing this is the foundation everything else sits on.

There is **zero MCP code** today. We build it fresh.

---

## Part 1 — Cost-shifting foundation (BYOK)

Nothing else is safe to ship until metered usage is attributed to the caller. Build this first.

### 1.1 Per-user credential vault

Standardize the keys a user can store in `user_settings`:

| `setting_key` | Provider | Metered cost it covers |
|---|---|---|
| `api_key_anthropic` | Anthropic | All LLM calls (scoring, classification, chat) |
| `api_key_exa` | Exa.ai | Web/semantic search in sourcing + monitors |
| `github_token` | GitHub | Builder/commit signal lookups |

Owner (Danny) keeps using env vars as the fallback. Everyone else must supply their own or the feature returns a clean "configure your key" error — **never a silent fall-through to Danny's key.**

### 1.2 One central resolver (replaces every ad-hoc client factory)

Create `server/lib/providerKeys.js`:

```js
// resolveKey(userId, provider) -> string | null
//  - returns the user's stored (decrypted) key if present
//  - else returns the env key ONLY for the owner (id === 1 / role 'admin')
//  - else null  (caller must surface a "configure your key" error)
function resolveKey(userId, provider) { /* ... */ }

// Convenience factories that throw a typed NoKeyError when null:
function anthropicFor(userId) { /* new Anthropic({ apiKey: resolveKey(...) }) */ }
function exaKeyFor(userId) { /* ... */ }
function githubTokenFor(userId) { /* ... */ }
```

This generalizes the logic already proven in `settings.js:144–146`. The owner check should be role-based (`role === 'admin'`), not hardcoded to `id === 1`, so it survives a real multi-user world.

### 1.3 Thread `userId` through the hot path

Refactor every metered call site to take a `userId` and resolve the caller's key:

- `routes/ai.js` — `getAnthropicClient()` → `anthropicFor(req.user.id)` in `/chat` and `/fit-score`.
- `pipeline/sourcing-engine.js` — its `getAnthropicClient()` + Exa + GitHub calls take the run's `userId`.
- `pipeline/talent-engine.js` — same.
- `routes/assessments.js` → `agents/*` — the multi-agent run takes the initiating `userId`.
- `pipeline/taste.js` — taste extraction runs under the owning user.

Any call site with no `userId` in scope is a latent "Danny pays" bug — that audit is part of the work.

### 1.4 Encrypt keys at rest

Today the test endpoint reads `setting_value` as plaintext. Before exposing keys to more users:

- Add `server/lib/secrets.js` — AES-256-GCM encrypt/decrypt with a server master key (`SETTINGS_ENC_KEY` env var).
- Encrypt on write in `PUT /api/settings/:key` for any `api_key_*` / `*_token` key; decrypt only inside `providerKeys.js`.
- One-time migration to encrypt existing plaintext keys.
- **Never** return a stored key to the client (only a masked hint like `sk-…ab12`, as the test endpoint already does), and **never** log it.

### 1.5 Per-user spend caps + usage ledger (protects the *user*)

A runaway agent loop calling an MCP tool could otherwise burn the founder's money. Add a guardrail that protects them (and bounds any shared resource):

- New table `usage_events(id, user_id, provider, kind, input_tokens, output_tokens, est_cost_usd, source, created_at)`.
- Record actual token usage returned by the Anthropic SDK after each call; estimate cost.
- New settings: `spend_cap_daily_usd` (default e.g. $10), `spend_cap_monthly_usd`.
- Enforce **before** each metered call: if the rolling spend would exceed the cap, refuse with a clear error rather than proceeding. Owner is exempt or has a higher default.

This doubles as the data source for any future metered-pay model (the `has_paid`/Stripe hooks already exist).

**Deliverable of Part 1:** any non-owner user's LLM/Exa/GitHub usage is billed to *their* keys, capped, encrypted, and audited. Danny pays only for Danny's own runs.

---

## Part 2 — Talent search over MCP

### 2.1 What gets exposed (and what does NOT)

Expose a **narrow, read-mostly Talent surface** — never the proprietary deal pipeline.

**Exposed tools:**
- `talent_search_candidates(query, filters)` — search/score candidates for the caller's own roles.
- `get_candidate(id)` — single candidate detail (caller's own rows only).
- `list_roles()` / `create_role(...)` — manage the caller's open roles.
- `get_matches(roleId)` — ranked candidate↔role matches.
- `create_monitor(...)` / `list_monitor_hits(...)` — set up and poll the alert monitors from Part 3.

**Explicitly NOT exposed over MCP:** `founders` (Danny's sourced founder pipeline / IP), `opportunity_assessments`, `steward_operator_evaluations`, `founder_notes`, `memos`, `deal_room`, settings/keys. The MCP server has no code path to these tables.

### 2.2 Data scoping (the safety core)

Every MCP tool resolves to a `user_id` and filters `WHERE user_id = ?` — identical to the existing REST pattern. A founder using MCP sees **only their own** talent rows, never Danny's and never another tenant's. Scope is enforced server-side; the client is never trusted to filter.

### 2.3 Auth — MCP tokens, separate from the web JWT

- New table `mcp_tokens(id, user_id, token_hash, label, scopes, created_at, last_used_at, revoked_at)`.
- Issue from a Settings UI ("Generate MCP token"); show once, store only the hash.
- Long-lived but **revocable**; scoped (e.g. `talent:read`, `talent:write`, `monitors`).
- Token → `user_id` → credential vault (Part 1). The caller's keys pay for the caller's calls.

### 2.4 Transport — hosted remote MCP (recommended)

Mount a streamable-HTTP/SSE MCP endpoint inside the existing Express app (`server/mcp/`), e.g. at `/mcp`, behind the existing rate limiter plus a per-token limiter. Use `@modelcontextprotocol/sdk`.

- **Hosted** keeps Danny in the distribution loop and lets the founder connect with just a URL + token. Recommended.
- **Self-host (stdio)** alternative: ship the MCP server as a small package the founder runs locally with their own keys — zero infra cost to Danny, but less control/visibility. Offer only if the founder insists.

### 2.5 Cost attribution over MCP

Every tool handler calls the Part 1 resolver with the token's `user_id`. If the founder hasn't configured a key, the tool returns a structured `error: "no_anthropic_key"` telling him to add one in Settings. **Danny's key is never reachable from a non-owner token.**

### 2.6 MCP-specific safety

- **Prompt injection:** tool results can contain scraped web text (bios, posts). Return it clearly delimited and labeled as untrusted data, never as instructions. Document that downstream agents must not execute it.
- **PII minimization:** return only fields the caller needs; honor `do_not_resurface`; provide a delete/opt-out path for any individual on request (CCPA/GDPR posture).
- **Audit:** log every MCP call (tool, user, token, timestamp, row counts) to a `job_runs`-style table; never log payloads containing keys or full PII.
- **Rate + spend limits:** per-token request limit *and* the Part 1 spend cap both apply.
- **Scope checks:** a `talent:read` token cannot call write/monitor tools.

---

## Part 3 — "YC founder just left" monitor

Built on a reusable **signal-monitor framework**, not as a one-off.

### 3.1 The framework: universe → snapshot → diff → classify → alert

Two new tables:

- `monitors(id, user_id, type, label, config_json, schedule, enabled, last_run_at, created_at)`
- `monitor_hits(id, monitor_id, user_id, entity_name, entity_url, signal_type, payload_json, intent, confidence, detected_at, notified_at, dismissed)`

A generic engine (`server/pipeline/monitor-engine.js`):
1. **Universe** — resolve the watch set from `config_json` (e.g. a YC founder list).
2. **Snapshot** — capture current state per entity from available signals.
3. **Diff** — compare to the last snapshot; emit candidate hits on state *transitions*, not absolute state.
4. **Classify** — Claude labels intent (under the owner's key).
5. **Alert** — write `monitor_hits`, notify, surface via MCP.

### 3.2 YC-just-left specifics

- **Universe:** YC company/founder directory (public, scrapable), filtered to the founder's interests in `config_json` (batch, sector, geography).
- **Signals of departure:**
  - LinkedIn/title transition: "Founder/CEO at X" → past tense / removed / "ex-".
  - Bio markers: "stealth", "building something new", no current company.
  - Company death: site down, shutdown/acqui-hire news.
  - **Reuse `departure_recency_months` + tenure heuristic** — flag departures after a real tenure (e.g. 18mo+), not early flameouts.
- **Classify (Claude):** *starting a new company* vs *open to joining a rocket ship* vs *taking a break*. This split is exactly the founder's two use cases.
- **Alert payload:** who, last company, when they left, signal source, inferred intent, contactability.

### 3.3 Cost + cadence

- The monitor runs under its **owner's** keys (Part 1) → the founder's watch is billed to the founder. Per-user cron entries, gated on key presence + spend cap.
- **Daily** cadence (departures aren't minute-sensitive) → cheap. Fits the existing `node-cron` block in `index.js`.

### 3.4 Delivery

- In-app inbox (`monitor_hits`).
- Optional webhook / email (reuse newsletter/email infra; `SLACK_WEBHOOK_URL` already scaffolded).
- MCP `list_monitor_hits` so the founder's own agent can poll: *"any YC founders leave this week?"*

### 3.5 Data-source / ToS note

LinkedIn is the gold signal and is hostile to direct scraping. Cleanest path: the **founder brings his own enrichment provider** (a people-data API or his Sales Navigator) — which conveniently keeps that cost on him too. Harmonic/Specter already sell this; Stu's edge is the founder-tuned watchlist piped straight into his agent.

---

## Part 4 — Other monitors of equal caliber (same engine, just config)

Each is a `monitors.type` over the Part 3 framework:

| Monitor | Universe | Transition signal | Why high-signal |
|---|---|---|---|
| **Founding-engineer departures** | Early employees (#1–50) at founder-factory cos (OpenAI, Anthropic, Stripe, Ramp…) | Leaves current role | Often the *next* founders, before they've declared |
| **Repeat-founder re-emergence** | Founders with a past exit | Acquisition lockup/earn-out window ending (~2–3 yrs post-exit) | Second-time founders, capitalized + pattern-aware |
| **Formation signals** | — | New Delaware C-corp / **SEC Form D** / domain / GitHub org | Earliest possible signal; **`entity_filings` + `filings-source.js` already exist** |
| **Team-forming** | Strong operators | Multiple people leaving same co → same new entity | Maps to your rubric's talent-magnetism trait |
| **Bulk availability** | — | Shutdown / layoff / wind-down news | A roster of strong people available at once |

Build the framework once; each new monitor is a config + a signal adapter.

---

## Part 5 — Build phases

| Phase | Deliverable | Depends on |
|---|---|---|
| **P1. BYOK foundation** | Central key resolver; thread `userId` through all metered call sites; encryption at rest; usage ledger + spend caps | — |
| **P2. MCP server** | `server/mcp/` with scoped Talent tools; `mcp_tokens` table + Settings UI; hosted `/mcp` endpoint; audit log | P1 |
| **P3. Monitor framework + YC-just-left** | `monitors`/`monitor_hits` tables; `monitor-engine.js`; YC universe + signals + classifier; per-user cron; in-app + MCP delivery | P1 (P2 for MCP delivery) |
| **P4. Additional monitors** | Founding-engineer, repeat-founder, formation (reuse `entity_filings`), team-forming, bulk-availability | P3 |

Ship P1 to "level 1" first (resolver live, no external user yet) and confirm your own usage still works on the env key before onboarding the founder.

---

## Part 6 — Risks & open decisions

**Risks / safety:**
- **LinkedIn ToS** — don't scrape directly; route through a compliant provider (and push that cost to the user's own key).
- **PII** — candidates/founders are real people. Minimize stored fields, honor `do_not_resurface`, provide opt-out/deletion.
- **Prompt injection** via scraped text returned through MCP — label untrusted, never execute.
- **Secret leakage** — encrypt at rest, mask in responses, never log.
- **Runaway spend** — spend caps protect the user; per-token rate limits protect the service.

**Two decisions only you can make:**
1. **Your proprietary founder DB** — MCP intentionally excludes `founders`/assessments. Keep it fully walled off (recommended), or expose a *read-only, rate-limited* slice as a premium surface later?
2. **MCP delivery** — hosted (recommended: distribution + visibility) vs self-host (zero infra cost, less control)?

---

## Part 7 — Concrete first-PR change list (Phase 1)

- `server/lib/providerKeys.js` — new: `resolveKey`, `anthropicFor`, `exaKeyFor`, `githubTokenFor`, `NoKeyError`.
- `server/lib/secrets.js` — new: AES-256-GCM encrypt/decrypt; `SETTINGS_ENC_KEY`.
- `server/routes/ai.js` — replace `getAnthropicClient()` with `anthropicFor(req.user.id)` (lines 5–14, 44, 89).
- `server/pipeline/sourcing-engine.js`, `talent-engine.js`, `taste.js` — accept `userId`; resolve keys per run.
- `server/routes/assessments.js` + `agents/*` — pass initiating `userId` into the agent run.
- `server/routes/settings.js` — encrypt `api_key_*`/`*_token` on write (line 119); add spend-cap settings.
- `server/db.js` — new tables: `usage_events`; (P2) `mcp_tokens`; (P3) `monitors`, `monitor_hits`.
- `.env.example` — add `SETTINGS_ENC_KEY`.

---

*Grounded in a full read of the `superior-os` codebase on 2026-06-19. The "use the user's key, fall back to env only for the owner" rule is the same one already implemented in `settings.js:142–166` — Phase 1 promotes it from the test endpoint into the real call path.*
