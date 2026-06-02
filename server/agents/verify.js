/**
 * Quote verification — the assessment trust layer.
 * ================================================
 * Agents are instructed to surface DIRECT quotes as evidence. An IC reading
 * "closed 4 customers in 6 weeks" has no way to know if that's verbatim from a
 * transcript or an LLM confabulation. This module checks every quote against the
 * source context — deterministically, with no extra LLM call — and tags it:
 *
 *   verbatim    — found word-for-word (after whitespace/punctuation normalization)
 *   paraphrased — most of the quote's content words appear in the source
 *   unverified  — not found; treat as a potential hallucination
 *
 * Verification NEVER changes a score. It only annotates, so the human can trust
 * (or distrust) the evidence behind a number.
 */

const STOPWORDS = new Set([
  'the', 'a', 'an', 'and', 'or', 'but', 'of', 'to', 'in', 'on', 'at', 'for',
  'with', 'is', 'are', 'was', 'were', 'be', 'been', 'being', 'this', 'that',
  'these', 'those', 'it', 'its', 'as', 'by', 'from', 'we', 'our', 'they',
  'their', 'has', 'have', 'had', 'will', 'would', 'can', 'could', 'i', 'he',
  'she', 'them', 'his', 'her', 'about', 'into', 'than', 'then', 'so',
]);

function normalize(s) {
  return String(s || '')
    .toLowerCase()
    .replace(/[‘’“”]/g, "'")  // smart quotes → '
    .replace(/[^a-z0-9\s']/g, ' ')                // punctuation → space
    .replace(/\s+/g, ' ')
    .trim();
}

function contentWords(normStr) {
  return normStr
    .split(' ')
    .filter(w => w.length >= 3 && !STOPWORDS.has(w));
}

/**
 * Classify a single quote against a normalized source corpus.
 * @returns {'verbatim'|'paraphrased'|'unverified'}
 */
function classifyQuote(quote, normContext, contextWordSet) {
  const nq = normalize(quote);
  if (!nq || nq.length < 4) return 'unverified';

  // Verbatim: the whole normalized quote is a substring of the source.
  if (normContext.includes(nq)) return 'verbatim';

  // Paraphrased: a strong majority of the quote's content words appear in source.
  const words = [...new Set(contentWords(nq))];
  if (words.length === 0) {
    // All stopwords / very short — fall back to substring only.
    return 'unverified';
  }
  const hits = words.filter(w => contextWordSet.has(w)).length;
  const coverage = hits / words.length;
  if (coverage >= 0.8) return 'paraphrased';
  return 'unverified';
}

/**
 * Annotate an agent's key_quotes with a `verification` field and attach a
 * `quote_integrity` summary. Mutates and returns the agent output object.
 */
function verifyAgentQuotes(agentOutput, context) {
  if (!agentOutput || typeof agentOutput !== 'object') return agentOutput;
  const quotes = Array.isArray(agentOutput.key_quotes) ? agentOutput.key_quotes : null;
  if (!quotes || quotes.length === 0) return agentOutput;

  const normContext = normalize(context);
  const contextWordSet = new Set(normContext.split(' '));

  const counts = { verbatim: 0, paraphrased: 0, unverified: 0 };
  for (const q of quotes) {
    // key_quotes entries may be strings or {quote, signal} objects.
    const text = typeof q === 'string' ? q : (q.quote || q.text || '');
    const verdict = classifyQuote(text, normContext, contextWordSet);
    counts[verdict]++;
    if (typeof q === 'object' && q !== null) q.verification = verdict;
  }

  agentOutput.quote_integrity = {
    total: quotes.length,
    ...counts,
    // A quick human-facing flag: any unverified quote warrants a look.
    has_unverified: counts.unverified > 0,
  };
  return agentOutput;
}

/** Run verification across all four agent outputs in place. */
function verifyAllAgents(agentOutputs, context) {
  for (const key of ['team', 'product', 'market', 'bear']) {
    if (agentOutputs[key] && !agentOutputs[key].error) {
      verifyAgentQuotes(agentOutputs[key], context);
    }
  }
  return agentOutputs;
}

module.exports = { verifyAgentQuotes, verifyAllAgents, classifyQuote, normalize };
