// ══════════════════════════════════════════════════════════════════════════
// extract-signals.js — propose. lib/signals.js disposes.
//
// This is the ONLY place a model touches the card, and it is deliberately the
// weakest link in the chain: everything it says is checked afterwards by code
// that cannot be talked out of its verdict. The model's job is narrow — read one
// source, point at lines worth noticing. It has no authority to assert anything.
//
// ── THE DESIGN PRINCIPLE ──
// Don't ask the model to be honest. Ask it for something CHECKABLE, then check.
// A prompt saying "do not hallucinate" buys nothing; a prompt that must return a
// quote which a deterministic verifier will look for in the source text buys
// everything, because a fabricated quote fails mechanically.
//
// So the prompt below is short. The rules that matter aren't in it.
//
// ── WHY EXTRACTION IS NOT ASSESSMENT ──
// The nightly `founder-call-auto-workup` already does the analysis better than
// Stu can: web research with cited URLs, a 4-lens investor panel, adversarial
// claim-testing. This does NOT compete with that. It answers one much smaller
// question — "what did this document actually say?" — so the card can show
// Danny facts with receipts rather than a machine's opinion.
// ══════════════════════════════════════════════════════════════════════════

const { KINDS } = require('./signals');
// anthropicFor, not getClient — a metered client billed to this user, with
// maxRetries:0 because routes/assessments.js already owns the retry layer and
// compounding the two once fired six requests per struggling agent.
const { MODEL, anthropicFor } = require('./providerKeys');

// 0. Same reason every scoring agent uses it: without it, six founders assessed
// twice on byte-identical inputs moved up to 1.1 points. Stu was sampling its own
// verdicts. Extraction must be reproducible or the same deck yields a different
// card every time it's read.
// WARNING: Sonnet 5 / Opus 4.7+ REJECT a non-default temperature with a 400. Any
// model bump breaks this line and every scoring agent with it.
const TEMPERATURE = 0;
const MAX_TOKENS = 4096;

const SYSTEM = `You read one document about a startup and point at the lines worth noticing.

Return JSON: { "signals": [ { "kind": ..., "claim": ..., "quote": ... } ] }

kind is one of: ${KINDS.join(', ')}

RULES
- "quote" MUST be copied character-for-character from the document. Not tidied, not
  shortened, not corrected. It will be searched for in the source text; if it is not
  found the signal is discarded and your work is wasted.
- "claim" is one plain sentence stating what the quote shows. It may not contain any
  number that does not appear in the document.
- Only what the document SAYS. Not what it implies, not what you know about the
  company, not context from elsewhere. If the document is a deck, remember a deck is
  a claim BY the founder, not a fact about the world — state it as what they say.
- Prefer the specific over the flattering. "Zero revenue today" is a signal.
  "Strong team" is not — it is an opinion with no line behind it.
- 12 signals maximum. If the document says little, return few. Returning nothing is
  a valid and useful answer.`;

const userPrompt = (source) => `Document type: ${source.kind}
Title: ${source.title || '(untitled)'}
${source.occurred_at ? `Dated: ${source.occurred_at}` : ''}

--- DOCUMENT ---
${String(source.content_text).slice(0, 60000)}
--- END ---

Return the JSON object. No preamble.`;

/**
 * Read one source, propose candidate signals. Returns [] on any failure —
 * extraction is best-effort, and a model that errors must never look like a
 * document that said nothing... which is why the CALLER reports the difference.
 */
async function extractFrom(source, { userId = 1, deps = {} } = {}) {
  if (!source?.content_text || source.content_text.length < 40) return { candidates: [], error: 'no readable text' };

  const client = 'client' in deps ? deps.client : anthropicFor(userId, 'card_signals');
  if (!client) return { candidates: [], error: 'no Anthropic key configured' };

  let text;
  try {
    const res = await client.messages.create({
      model: MODEL,
      max_tokens: MAX_TOKENS,
      temperature: TEMPERATURE,
      system: SYSTEM,
      messages: [{ role: 'user', content: userPrompt(source) }],
    });
    text = res.content[0].text.trim();
  } catch (e) {
    return { candidates: [], error: `model call failed: ${e.message}` };
  }

  const parsed = parseJson(text);
  if (!parsed?.signals) return { candidates: [], error: 'model returned unparseable output' };

  return {
    candidates: parsed.signals.filter((s) => s && s.claim && s.quote).slice(0, 12),
    model: MODEL,
  };
}

// The model sometimes wraps JSON in prose or a fence. Cheap to tolerate.
function parseJson(text) {
  try { return JSON.parse(text); } catch { /* fall through */ }
  const fence = text.match(/```(?:json)?\s*([\s\S]*?)```/);
  if (fence) { try { return JSON.parse(fence[1]); } catch { /* fall through */ } }
  const brace = text.match(/\{[\s\S]*\}/);
  if (brace) { try { return JSON.parse(brace[0]); } catch { /* fall through */ } }
  return null;
}

module.exports = { extractFrom, SYSTEM, TEMPERATURE };
