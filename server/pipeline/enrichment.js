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
const { anthropicFor } = require('../lib/providerKeys');

const MODEL = 'claude-sonnet-4-6';

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

  let parsed;
  try {
    const resp = await client.messages.create({
      model: MODEL, max_tokens: 4096, system: SYSTEM,
      messages: [{ role: 'user', content: buildPrompt(items, context) }],
    });
    parsed = parseJsonArray(resp.content?.[0]?.text || '');
  } catch {
    return null; // degrade to deterministic on any LLM/parse failure
  }
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
