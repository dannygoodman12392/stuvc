const pdfParse = require('pdf-parse');
const { MODEL } = require('../lib/providerKeys');

const EXTRACTION_PROMPT = `You are a data extraction assistant. Extract founder/startup information from the following document text.

Return a JSON array of objects. Each object represents one founder or startup with these fields (include only fields you can confidently extract):

- name: Full name of the founder
- company: Company/startup name
- role: Their role or title
- email: Email address
- linkedin_url: LinkedIn profile URL
- twitter: Twitter/X handle or URL
- github_url: GitHub profile URL
- website_url: Company or personal website
- location_city: City or location
- location_state: State or region
- domain: Industry/sector (e.g., "AI/ML", "Fintech", "Health Tech")
- stage: Funding stage (e.g., "Pre-seed", "Seed", "Series A")
- company_one_liner: One-line description of what the company does
- bio: Brief background on the founder
- source: Where/how this person was found (e.g., conference name, list name)
- previous_companies: Notable previous companies or roles
- notable_background: Any notable credentials, education, or achievements

Rules:
- Extract EVERY person/company mentioned in the document
- If a field isn't available, omit it (don't guess)
- For LinkedIn URLs, include the full URL if present
- If only a first name is given, still include it
- Maximum 100 entries
- Return ONLY the JSON array, no other text

Document text:
`;

// `anthropicApiKey` is retained but UNUSED — anthropicFor() resolves the key
// itself from user_settings. Keeping the parameter avoids touching the call site
// signature; `userId` is what actually matters now, because it's what the meter
// and the spend cap key off.
async function extractFromPDF(buffer, anthropicApiKey, userId = 1) {
  // Parse PDF to text
  const pdfData = await pdfParse(buffer);
  const text = pdfData.text;

  if (!text || text.trim().length < 10) {
    throw new Error('Could not extract text from PDF. The file may be image-based or empty.');
  }

  // ══════════════════════════════════════════════════════════════════════
  // This constructed a RAW Anthropic client — unmetered, uncapped, and with the
  // SDK's default maxRetries: 2.
  //
  // Three consequences, all real:
  //   · Every deck upload sends ~12.5K tokens (50K chars) that appear NOWHERE in
  //     usage_events. Spend you cannot see is spend you cannot manage — the cost
  //     audit literally could not price this path.
  //   · assertWithinBudget never ran here, so it spends past any cap.
  //   · maxRetries: 2 reintroduces the retry compounding that providerKeys.js:193
  //     sets to 0 everywhere else, precisely because SDK retries x wrapper retries
  //     once fired six requests per struggling agent.
  //
  // anthropicFor() fixes all three at once: metered, capped, maxRetries 0.
  // It resolves the key itself, so the caller's key is no longer needed — but the
  // signature keeps accepting it rather than breaking two call sites.
  const { anthropicFor } = require('../lib/providerKeys');
  const client = anthropicFor(userId, 'pdf-extract');
  if (!client) throw new Error('No Anthropic key configured — add one in Settings.');

  const response = await client.messages.create({
    model: MODEL,
    max_tokens: 4096,
    // Pinned. This is a structured extraction from a fixed document: the same deck
    // must yield the same fields. Unpinned it re-samples, so re-uploading a deck
    // pays again for a different answer to an identical question.
    temperature: 0,
    messages: [{
      role: 'user',
      content: EXTRACTION_PROMPT + text.slice(0, 50000) // Cap at ~50k chars
    }],
  });

  // Parse Claude's response
  const responseText = response.content[0]?.text || '[]';

  // Extract JSON from response (handle markdown code blocks)
  let jsonStr = responseText;
  const jsonMatch = responseText.match(/```(?:json)?\s*([\s\S]*?)```/);
  if (jsonMatch) jsonStr = jsonMatch[1];

  let founders;
  try {
    founders = JSON.parse(jsonStr.trim());
  } catch {
    throw new Error('Failed to parse extracted data. The PDF may not contain structured founder information.');
  }

  if (!Array.isArray(founders)) {
    founders = [founders];
  }

  // Add row indices and validate
  return founders.slice(0, 100).map((f, idx) => ({
    _row: idx + 1,
    ...f,
    _raw: f, // Keep original for reference
  })).filter(f => f.name || f.company); // Must have at least a name or company
}

// Extract raw text from a PDF buffer (for assessment deck ingestion — no LLM).
// Throws on image-only/unreadable PDFs so callers can flag the deck as not ingested.
async function extractPdfText(buffer) {
  const pdfData = await pdfParse(buffer);
  const text = (pdfData.text || '').trim();
  if (text.length < 20) {
    throw new Error('PDF produced no extractable text (likely image-only/scanned). Export a text-based PDF.');
  }
  return text;
}

module.exports = { extractFromPDF, extractPdfText };
