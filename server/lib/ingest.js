// ══════════════════════════════════════════════════════════════════════════
// ingest.js — the pipes into the source log.
//
// Danny: "These cards should be a living, dynamic log of data I feed it from
// uploaded decks, URL links, LinkedIn links, notes, Granola notes."
//
// Four ways text gets into a card, and one rule they all share: EXTRACT THE TEXT
// OR RECORD NOTHING. A source with no readable content_text can never father a
// signal (lib/signals.js enforces that), so an ingest that half-works must fail
// loudly rather than store an empty husk that looks like it worked.
//
// Verified live 2026-07-16:
//   Exa   POST https://api.exa.ai/contents  { urls, text:{maxCharacters} }
//         x-api-key header -> { results: [{ title, url, text }] }
//         permute.ai -> 3,000 chars of clean text.
// ══════════════════════════════════════════════════════════════════════════

const https = require('https');
const { recordSource } = require('./signals');

let resolveKey;
try { ({ resolveKey } = require('./providerKeys')); } catch { resolveKey = () => null; }

function httpPostJson(hostname, path, headers, body) {
  return new Promise((resolve) => {
    const d = JSON.stringify(body);
    const req = https.request(
      { hostname, path, method: 'POST', headers: { ...headers, 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(d) } },
      (res) => {
        let b = '';
        res.on('data', (c) => (b += c));
        res.on('end', () => { try { resolve({ status: res.statusCode, data: JSON.parse(b) }); } catch { resolve({ status: res.statusCode, data: null }); } });
      }
    );
    req.on('error', () => resolve({ status: 0, data: null }));
    req.setTimeout(25000, () => { req.destroy(); resolve({ status: 0, data: null }); });
    req.write(d);
    req.end();
  });
}

// ── 1. A URL. Exa reads the open web; this is what that key is genuinely for. ──
// LinkedIn is deliberately NOT routed here: it blocks crawlers, so Exa would
// return a login wall, and a login wall has text — which means it would sail
// through as a "source" and produce confident signals about nothing. LinkedIn
// goes through EnrichLayer (company-enrich.js) or not at all.
const BLOCKED_HOSTS = [/(^|\.)linkedin\.com$/i];

async function ingestUrl({ founderId, url, userId = 1, deps = {} }) {
  const key = 'exaKey' in deps ? deps.exaKey : resolveKey(userId, 'exa');
  if (!key) return { error: 'No Exa key configured — add one in Settings to read URLs.' };

  let host;
  try { host = new URL(url).hostname; } catch { return { error: `Not a URL: ${url}` }; }
  if (BLOCKED_HOSTS.some((re) => re.test(host))) {
    return {
      error: 'LinkedIn blocks crawlers — Exa would return a login page.',
      detail: 'Put the company LinkedIn URL in the card field instead; that goes through EnrichLayer.',
    };
  }

  const post = deps.post || httpPostJson;
  const { status, data } = await post('api.exa.ai', '/contents', { 'x-api-key': key },
    { urls: [url], text: { maxCharacters: 20000 } });

  if (status !== 200 || !data?.results?.length) {
    return { error: `Couldn't read ${host} (HTTP ${status}).` };
  }
  const r = data.results[0];
  const text = String(r.text || '').trim();

  // A page that returned no text is a FAILURE, not an empty source. Storing it
  // would put a row on the card that looks ingested and can never yield anything.
  if (text.length < 80) {
    return { error: `${host} returned almost no text (${text.length} chars) — probably JS-rendered or gated.` };
  }

  const s = recordSource({
    founderId, kind: 'url', title: r.title || host, uri: url,
    contentText: text, meta: { host, chars: text.length }, addedBy: userId,
  });
  return { ...s, title: r.title || host, chars: text.length };
}

// ── 2. A deck. pdf-parse was installed and never used. ──
async function ingestDeck({ founderId, buffer, fileName, userId = 1 }) {
  let parsed;
  try {
    const pdf = require('pdf-parse');
    parsed = await pdf(buffer);
  } catch (e) {
    return { error: `Couldn't read that PDF: ${e.message}` };
  }
  const text = String(parsed.text || '').trim();

  // The single most common real failure: a deck exported as images. It parses
  // fine and yields ~nothing. Saying so is the whole job — "uploaded ✓" next to a
  // card that never produces a signal is how Danny concludes the feature is
  // broken when actually his file is.
  if (text.length < 120) {
    return {
      error: `That PDF has almost no extractable text (${text.length} chars across ${parsed.numpages} pages).`,
      detail: 'It is probably a slide export made of images. A text-based PDF, or paste the content as a note.',
    };
  }

  const s = recordSource({
    founderId, kind: 'deck', title: fileName, uri: fileName,
    contentText: text, meta: { pages: parsed.numpages, chars: text.length }, addedBy: userId,
  });
  return { ...s, title: fileName, pages: parsed.numpages, chars: text.length };
}

// ── 3. A Granola call note, pushed by the nightly workup task. ──
// Granola has no webhook and its MCP is the ASSISTANT's, not the server's — a
// native integration was priced at 4-6 days and may be impossible. But
// `founder-call-auto-workup` already reads Granola every night on Danny's laptop
// and already pushes commitments to a secret-gated endpoint. This is the same
// road, carrying the note itself.
//
// occurredAt is the CALL date, not the ingest date. A note pushed tonight about a
// call from March must not read as fresh contact — that distinction is exactly
// what lib/attention.js is blocked on.
function ingestGranolaNote({ founderId, title, text, occurredAt, granolaId, userId = 1 }) {
  const body = String(text || '').trim();
  if (body.length < 40) return { error: 'Granola note has no substance' };
  return recordSource({
    founderId, kind: 'granola', title: title || 'Call', uri: granolaId ? `granola:${granolaId}` : null,
    contentText: body, occurredAt: occurredAt || null,
    meta: { granola_id: granolaId || null }, addedBy: userId,
  });
}

// ── 4. Danny types something. His words are a source like any other. ──
// Deliberately the same shape: a note he writes can father signals, and those
// signals are checked against his own text. He is not exempt from the gate — not
// because he lies, but because a quote attributed to a note has to actually be in
// that note or the receipt means nothing.
function ingestNote({ founderId, text, title, occurredAt, userId = 1 }) {
  const body = String(text || '').trim();
  if (!body) return { error: 'empty note' };
  return recordSource({
    founderId, kind: 'note', title: title || 'Note', contentText: body,
    occurredAt: occurredAt || null, addedBy: userId,
  });
}

module.exports = { ingestUrl, ingestDeck, ingestGranolaNote, ingestNote, BLOCKED_HOSTS };
