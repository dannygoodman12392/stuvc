const pdfParse = require('pdf-parse');

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

async function extractFromPDF(buffer, anthropicApiKey) {
  // Parse PDF to text
  const pdfData = await pdfParse(buffer);
  const text = pdfData.text;

  if (!text || text.trim().length < 10) {
    throw new Error('Could not extract text from PDF. The file may be image-based or empty.');
  }

  // Use Claude to extract structured data
  const Anthropic = require('@anthropic-ai/sdk');
  const client = new Anthropic({ apiKey: anthropicApiKey });

  const response = await client.messages.create({
    model: 'claude-sonnet-4-20250514',
    max_tokens: 4096,
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

module.exports = { extractFromPDF };
