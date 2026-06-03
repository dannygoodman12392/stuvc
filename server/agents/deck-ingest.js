/**
 * Deck ingestion planning + integrity detection.
 * Pure, testable helpers used by the assessment input pipeline. The hard rule:
 * a deck is either ingested as real text, or explicitly marked NOT INGESTED — never
 * stored as corrupted binary/garbage that an agent then scores on.
 */

function notIngestedMarker(reason) {
  return `[PITCH DECK NOT INGESTED — ${reason}. The deck content is unavailable; do NOT infer or fabricate slide contents, and treat product/traction claims as unverified.]`;
}

// Decide how to handle an incoming deck input.
// Returns { mode: 'pdf' | 'link' | 'empty' | 'text', content? }
function planDeck(deck) {
  if (deck && deck.base64 && /pdf/i.test(deck.mimeType || '')) return { mode: 'pdf' };
  const content = (deck && deck.content ? String(deck.content) : '').trim();
  if (/^https?:\/\//i.test(content) && content.length < 400) return { mode: 'link', content };
  if (!content || content.length < 20) return { mode: 'empty' };
  return { mode: 'text', content };
}

// Detect a deck whose stored content is corrupted (e.g. a PDF that was read as text by
// the old client bug) or is an un-ingested link. Used to flag historical assessments.
function deckContentIntegrity(content) {
  const s = String(content || '');
  if (!s.trim()) return { status: 'empty' };
  if (s.startsWith('[PITCH DECK NOT INGESTED')) return { status: 'not_ingested' };
  if (/^https?:\/\//i.test(s.trim()) && s.trim().length < 400) return { status: 'link' };
  // Corrupted-binary signatures from readAsText() on a PDF/PPTX:
  if (s.slice(0, 1000).includes('%PDF-')) return { status: 'corrupted', reason: 'raw PDF bytes stored as text' };
  if (/endstream|\/Type\s*\/Catalog|stream\r?\n.*\b(obj|xref)\b/.test(s.slice(0, 4000))) return { status: 'corrupted', reason: 'PDF object markers in text' };
  // High ratio of non-printable / replacement chars → binary read as text
  const sample = s.slice(0, 4000);
  const nonPrintable = (sample.match(/[�\x00-\x08\x0E-\x1F]/g) || []).length;
  if (sample.length > 200 && nonPrintable / sample.length > 0.1) return { status: 'corrupted', reason: 'high non-printable ratio' };
  return { status: 'ok' };
}

module.exports = { planDeck, notIngestedMarker, deckContentIntegrity };
