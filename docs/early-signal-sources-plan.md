# Early Builder-Signal Data Sources — Build-Out Proposal

**Date:** 2026-06-19 · **Status:** proposal, awaiting go
**Goal:** surface **stealth and very-early-stage builders before they declare**, by adding public-data sources that name a person at the moment of formation — geo-filtered to Chicago/IL on Danny's instance, and to each user's own criteria otherwise.

---

## Principles

1. **Early beats complete.** Catch the first *public trace* — a filing, a cert, a new org — not the polished announcement.
2. **Person-named filings first.** A source is only actionable if we can tie it to a human. Prioritize records that name people (trademark owners, Form D officers, grant PIs) over ones that only name an entity.
3. **Geo-aware by default.** Every source honors the requesting user's location criteria. For you that's Chicago/IL (a hard filter); for external founders, their own; none set = open.
4. **BYOK-safe.** The *fetch* from public APIs is free. Only the enrichment/scoring pass spends the user's Anthropic key, under their daily cap. Cost-shift is preserved.
5. **Evidence-bearing.** Every signal carries the verbatim filing/record behind it — same bar as today's tie/caliber evidence.
6. **One pattern, many sources.** A pluggable connector interface, not N bespoke scrapers. Adding a source becomes a ~50-line file.

---

## The core abstraction — a `SourceConnector` framework

Today's sources are slightly ad-hoc (sourcing-engine = Exa, `filings-source.js` = Form D + IL SoS, discovery = Exa). The elegant move is to unify them behind one interface and one ingest pipeline.

```js
// A connector: small, declarative, testable in isolation.
{
  key: 'uspto_trademark',
  label: 'USPTO trademark filings',
  emits: 'trademark_filing',          // a builder-signal key
  free: true,                          // no per-user paid key needed to fetch
  cadence: 'daily',
  async fetch({ since, criteria, keys }) { return RawRecord[]; }
}

// RawRecord — normalized shape every connector returns:
{ name?, entity_name?, location_state?, role?, evidence, url, raw }
```

A **registry** of connectors feeds **one shared pipeline** (written once, reused by all):

```
fetch(since)
  → normalize to RawRecord
  → GEO-FILTER  (verifyLocation against the user's criteria)   ← Phase 1
  → person-resolve (which human is behind this filing?)
  → enrich + score (LLM, user's key, spend-capped)             ← reuses enrichment.js
  → dedup (linkedin/name/entity)
  → persist to sourced_founders (source=key, builder_signals=[emits])
  → fire matching monitors
```

This subsumes Exa, Form D, and IL SoS under the same path, and makes every new source inherit geo-filtering, enrichment, dedup, and monitoring for free.

---

## Phase 1 (pre-approved): the unified geo-filter

The piece you just approved. Discovery and every connector run their results through the sourcing engine's existing **`verifyLocation(text, headline, criteria)`** using the requesting user's `sourcing_locations` + `sourcing_schools` settings:

- **You** → criteria are Chicago/IL → Discover **hard-filters** to a verified IL tie (drops the rest) *and* stores the tie, so discovered founders display correctly in your inbox instead of as untied.
- **External founder** → their criteria apply (NYC → NYC; none set → open, global).

Closes the "Discover could surface non-IL founders" gap on your instance. No hardcoding — it respects what each user configured.

---

## Phase 2+: the connectors (prioritized by signal-per-effort)

| # | Source | Catches | Signal emitted | Names a person? | Geo field | Access |
|---|---|---|---|---|---|---|
| 1 | **USPTO trademarks** | A founder names their company/product months pre-launch | `trademark_filing` | ✅ owner + attorney | owner address (state) | Free public API |
| 2 | **SBIR/STTR + NIH RePORTER** | Deep-tech/bio founders take non-dilutive grants at/near formation | `grant_awarded` | ✅ PI | institution location | Free APIs |
| 3 | **OpenCorporates** | DE + multi-state incorporations (IL SoS misses Delaware C-corps) | `new_incorporation` | ⚠️ officers where disclosed | jurisdiction/state | Freemium *(confirm tier at build)* |
| 4 | **Certificate Transparency (crt.sh)** | A new TLS cert = a site/staging domain going live pre-launch | `new_domain` | ❌ domain only → correlate | n/a (enrich) | Free |
| 5 | **GitHub / Hugging Face new orgs** | AI/dev founders create the org before the company | `new_org` | ✅ org members | profile location | Free APIs |
| 6 | **WARN notices + H-1B/LCA** | Bulk talent availability; a new co's first visa sponsorship | `bulk_availability` / `new_employer` | ⚠️ company | state | Free bulk data |

**New builder signals + monitor types** unlocked: `trademark_filing`, `grant_awarded`, `new_incorporation` (extends today's `fresh_incorporation`), `new_domain`, `new_org`. Each becomes both a filterable signal (in search/Discover) and an alertable monitor type ("alert me when an IL filer trademarks an AI company").

---

## Cost / BYOK model

- **Fetch is free** for the public-gov sources (USPTO, SBIR, NIH, crt.sh, GitHub) → run as a **shared daily job** that caches raw records, so we never re-hit an API per user.
- **Person-resolution + scoring** runs per user on **their** Anthropic key, under their spend cap.
- Net: cheap to operate, and the cost-shift contract holds. OpenCorporates is the only one with a paid tier to confirm.

---

## Data-model change

Generalize the existing `entity_filings` table (already holds Form D + IL SoS) into a broader **`signal_records`** store: `(source, signal_type, entity_name, person_name, location_state, evidence, url, raw_json, matched_to_id, captured_at)`. One table backs every connector and feeds the same dedup/match logic. Add the new signal keys to `builderSignals.js`.

---

## Phasing

| Phase | Ships | Why this order |
|---|---|---|
| **P1** | `SourceConnector` framework + unified **geo-filter** (approved) + **USPTO trademarks** connector | Delivers your IL filter, proves the pluggable pattern, and adds the single highest-signal new source — all free to run |
| **P2** | **SBIR/NIH grants** + **OpenCorporates** | Opens deep-tech/bio (which Exa/GitHub miss) and fixes Delaware blindness |
| **P3** | **CT logs** + **GitHub/HF orgs** + **WARN/H-1B** | Earliest digital traces + talent-availability; higher noise, needs correlation |

Each phase ships a connector + a signal + a monitor type, fully geo-filtered, BYOK-safe, and tested — no half-states.

---

## Risks / honest constraints

- **Person↔entity correlation** is the hard part for stealth. Form D officers, trademark owners, and grant PIs name people directly (easy). CT logs and domains name only an entity → need an enrichment correlation step (medium reliability).
- **Delaware opacity** — DE hides officer names; Form D + trademarks compensate.
- **ToS / rate limits** — gov APIs are fine; OpenCorporates tier to confirm; we continue to avoid scraping LinkedIn directly.
- **False positives** — the evidence-gated scoring + the IL geo-filter keep the inbox clean (same discipline as the current tie gate).
- **Latency** — trademarks/grants are leads, not confirmations; they point you at someone early, and the enrichment pass confirms the person + tie.

---

## Recommendation

Build **P1 first**: the `SourceConnector` framework + the geo-filter + the **USPTO trademark** connector. It ships the approved IL filter, establishes the pattern every future source plugs into, and adds the highest signal-per-effort new source — with zero per-use cost. Then P2/P3 are each a small connector on the same rails.
