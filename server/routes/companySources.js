// ══════════════════════════════════════════════════════════════════════════
// The pipes into a company card's source log.  Mounted at /api/companies.
//
// NOT routes/sources.js — that name was already taken by the sourcing CONNECTORS
// route (yc_directory, a16z_speedrun, …). Different layer, same word.
//
// Danny: "These cards should be a living, dynamic log of data I feed it from
// uploaded decks, URL links, LinkedIn links, notes, Granola notes."
//
// INGEST and EXTRACT are separate calls on purpose. Ingest is free and instant;
// extraction costs a model call. Uploading a deck must never silently spend
// money, and a failed extraction must never lose the deck.
// ══════════════════════════════════════════════════════════════════════════

const express = require('express');
const multer = require('multer');
const router = express.Router();
const db = require('../db');
const signals = require('../lib/signals');
const ingest = require('../lib/ingest');
const { extractFrom } = require('../lib/extract-signals');

// In memory, and we keep the TEXT not the binary. Storing files would need a
// volume — and DATABASE_PATH is already the one persistence question nobody has
// answered on this deploy. Danny has the original deck; Stu needs its words.
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 25 * 1024 * 1024 } });

const owns = (userId, founderId) =>
  db.prepare('SELECT id FROM founders WHERE id = ? AND created_by = ? AND is_deleted = 0').get(founderId, userId);

// ── GET /api/companies/:id/sources — the log, and what each source produced ──
router.get('/:id/sources', (req, res) => {
  if (!owns(req.user.id, req.params.id)) return res.status(404).json({ error: 'not found' });
  res.json({
    sources: signals.sourcesFor(req.params.id),
    signals: signals.signalsFor(req.params.id),
  });
});

router.post('/:id/sources/url', async (req, res) => {
  if (!owns(req.user.id, req.params.id)) return res.status(404).json({ error: 'not found' });
  if (!req.body?.url) return res.status(400).json({ error: 'url required' });
  const r = await ingest.ingestUrl({ founderId: Number(req.params.id), url: req.body.url, userId: req.user.id });
  if (r.error) return res.status(400).json(r);
  res.json(r);
});

router.post('/:id/sources/deck', upload.single('file'), async (req, res) => {
  if (!owns(req.user.id, req.params.id)) return res.status(404).json({ error: 'not found' });
  if (!req.file) return res.status(400).json({ error: 'no file' });
  const r = await ingest.ingestDeck({
    founderId: Number(req.params.id), buffer: req.file.buffer,
    fileName: req.file.originalname, userId: req.user.id,
  });
  if (r.error) return res.status(400).json(r);
  res.json(r);
});

router.post('/:id/sources/note', (req, res) => {
  if (!owns(req.user.id, req.params.id)) return res.status(404).json({ error: 'not found' });
  const r = ingest.ingestNote({
    founderId: Number(req.params.id), text: req.body?.text,
    title: req.body?.title, occurredAt: req.body?.occurred_at, userId: req.user.id,
  });
  if (r.error) return res.status(400).json(r);
  res.json(r);
});

// ── Propose, then gate. ──
// The response reports proposed AND kept AND why each was dropped. A gate you
// can't see is indistinguishable from an extractor that found nothing.
router.post('/:id/sources/:sourceId/extract', async (req, res) => {
  if (!owns(req.user.id, req.params.id)) return res.status(404).json({ error: 'not found' });
  const source = db.prepare('SELECT * FROM company_sources WHERE id = ? AND founder_id = ?')
    .get(req.params.sourceId, req.params.id);
  if (!source) return res.status(404).json({ error: 'no such source' });

  const { candidates, error, model } = await extractFrom(source, { userId: req.user.id });
  if (error) return res.status(502).json({ error });

  // Re-reading the same deck must not double the card.
  db.prepare('DELETE FROM company_signals WHERE source_id = ?').run(source.id);

  const r = signals.recordSignals({
    founderId: Number(req.params.id), sourceId: source.id, candidates, model, createdBy: req.user.id,
  });
  res.json({ proposed: candidates.length, ...r });
});

// The signals go with it. A claim must never outlive its evidence.
router.delete('/:id/sources/:sourceId', (req, res) => {
  if (!owns(req.user.id, req.params.id)) return res.status(404).json({ error: 'not found' });
  signals.deleteSource(Number(req.params.id), Number(req.params.sourceId));
  res.json({ deleted: true });
});

module.exports = router;
