/**
 * enrichment.js — turn raw discovered/saved profiles into an analyst's brief.
 *
 * Takes a batch of lightweight profiles (name, headline, bio, detected signals) and uses
 * one Claude call (the user's own key, metered) to return, per person: clean name/company/
 * role, a 1–2 sentence trajectory summary, a one-line "why this person is a unicorn
 * builder," a 0–100 unicorn score, and a contactability read. This is the difference
 * between a list of links and a ranked shortlist you'd act on.
 *
 * BYOK: if the user has no Anthropic key, enrichProfiles returns null and callers fall
 * back to the deterministic signal output (still useful, just unscored).
 *
 * `deps.client` is injectable for tests (no network).
 */
const { anthropicFor, MODEL } = require('../lib/providerKeys');

const SYSTEM = `You are a top-decile talent and founder analyst for a pre-seed venture fund.
You evaluate people on their potential to build or join a category-defining ("unicorn") company.
You are sharp, specific, and never generic. You reward operating evidence over titles.
Score conservatively: 90+ is rare and reserved for unmistakable outlier builders.`;

function buildPrompt(items, context) {
  return `${context ? `CONTEXT (what the user is looking for): ${context}\n\n` : ''}For each person below, return your read.

People (JSON):
${JSON.stringify(items, null, 1)}

Return ONLY a JSON array, one object per person, in the same order, with these fields:
- i: the person's index (echo it back)
- name: cleaned full name
- company: their current/most-recent company (or null)
- role: their role (or null)
- summary: 1-2 sentences on their trajectory and what they actually built/did. Specific, no fluff.
- why: ONE line — why they're a high-potential unicorn builder (or why not). Concrete.
- unicorn_score: integer 0-100, your honest read of unicorn-builder potential
- contactability: "high" | "medium" | "low" — how reachable/open they likely are
- confidence: 0-1, your confidence given the thin input

Return ONLY the JSON array, no markdown, no preamble.`;
}

function parseJsonArray(text) {
  let s = (text || '').trim();
  const fence = s.match(/```(?:json)?\s*([\s\S]*?)```/);
  if (fence) s = fence[1].trim();
  const start = s.indexOf('[');
  const end = s.lastIndexOf(']');
  if (start !== -1 && end !== -1) s = s.slice(start, end + 1);
  const arr = JSON.parse(s);
  return Array.isArray(arr) ? arr : null;
}

// Returns an array aligned to `profiles` with enrichment merged in, or null if no key.
async function enrichProfiles(userId, profiles, { context = '', feature = 'enrich', deps = {} } = {}) {
  if (!profiles || !profiles.length) return [];
  const client = deps.client || anthropicFor(userId, feature);
  if (!client) return null; // no key → caller falls back to deterministic output

  const items = profiles.map((p, i) => ({
    i,
    name: p.name,
    headline: p.headline || '',
    bio: (p.bio || '').slice(0, 1200),
    signals: (p.matched_signals || []).map(s => s.key),
  }));

  // ══════════════════════════════════════════════════════════════════════
  // CHUNK. This call used to send EVERY profile in one request at
  // max_tokens: 4096 — and paid full price to throw the answer away.
  //
  // The database proves it, with a split so clean it reads like a controlled
  // experiment (measured 2026-07-16 from usage_events + sourced_founders):
  //
  //   source            rows  enriched  output_tokens   cost      outcome
  //   yc_directory       144      0     4096 (CAPPED)   $0.0927   all discarded
  //   a16z_speedrun      317      0     4096 (CAPPED)   $0.1699   all discarded
  //   pre_program         61      0     4096 (CAPPED)   $0.0730   all discarded
  //   thiel_fellows       28     28     3440            $0.0571   worked
  //   emergent_ventures   24     24     3045            $0.0507   worked
  //   z_fellows           23     23     2887            $0.0477   worked
  //   neo_scholars        13     13     1645            $0.0278   worked
  //   the_residency       11     11     1375            $0.0233   worked
  //
  // Every batch under ~30 fit and succeeded. Every batch over ~60 hit the ceiling
  // EXACTLY, parseJsonArray got truncated JSON, returned null, and the whole
  // batch was dropped. $0.34 spent for zero rows, and 525 of 647 sourced founders
  // sat unenriched despite having been paid for.
  //
  // The failure was invisible because it degrades "gracefully": the caller falls
  // back to deterministic output, so the pipeline keeps working and nobody sees
  // that the LLM half never lands. A silent fallback around a paid call is how
  // you buy nothing, repeatedly, and never find out.
  //
  // 25 is deliberately below the ~30 where the observed failures start — the
  // measured ceiling is a property of these bios, and a wide margin costs one
  // extra request rather than an entire batch.
  const CHUNK = 25;
  const chunks = [];
  for (let i = 0; i < items.length; i += CHUNK) chunks.push(items.slice(i, i + CHUNK));

  const parsedAll = [];
  for (const chunk of chunks) {
    let part;
    try {
      const resp = await client.messages.create({
        model: MODEL,
        max_tokens: 4096,
        // 0, like every other extraction path. Unpinned, this re-samples on every
        // run — and since ingestAll re-reads the same sources nightly, that was
        // paying for a different answer to an identical question.
        temperature: 0,
        system: SYSTEM,
        messages: [{ role: 'user', content: buildPrompt(chunk, context) }],
      });
      part = parseJsonArray(resp.content?.[0]?.text || '');
    } catch {
      part = null; // one bad chunk must not discard the ones that worked
    }
    if (part) parsedAll.push(...part);
    else console.warn(`[Enrich] chunk of ${chunk.length} failed to parse — those rows fall back to deterministic`);
  }

  const parsed = parsedAll.length ? parsedAll : null;
  if (!parsed) return null;

  const byIndex = new Map(parsed.filter(x => x && Number.isInteger(x.i)).map(x => [x.i, x]));
  return profiles.map((p, i) => {
    const e = byIndex.get(i) || {};
    const detConf = p.matched_signals?.length ? p.matched_signals[0].confidence : 0;
    const unicorn = Number.isFinite(e.unicorn_score) ? Math.max(0, Math.min(100, Math.round(e.unicorn_score))) : Math.round(detConf * 100);
    return {
      ...p,
      name: e.name || p.name,
      company: e.company ?? p.company ?? null,
      role: e.role ?? p.role ?? null,
      summary: e.summary || null,
      why: e.why || null,
      unicorn_score: unicorn,
      contactability: e.contactability || null,
      enrich_confidence: Number.isFinite(e.confidence) ? e.confidence : null,
      enriched: true,
    };
  }).sort((a, b) => (b.unicorn_score || 0) - (a.unicorn_score || 0));
}

module.exports = { enrichProfiles, MODEL };
