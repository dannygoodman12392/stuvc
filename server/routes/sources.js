/**
 * routes/sources.js — /api/sources (web-session authed).
 * List the early-signal connectors and run one on demand. The run does fetch + enrich
 * (LLM spend on the caller's key), so it's throttled and spend-cap gated.
 */
const express = require('express');
const rateLimit = require('express-rate-limit');
const router = express.Router();
const sources = require('../pipeline/sources');
const { SpendCapError } = require('../lib/providerKeys');

const runLimiter = rateLimit({ windowMs: 15 * 60 * 1000, max: 10, standardHeaders: true, legacyHeaders: false });

// GET /api/sources — available connectors (key, label, signal emitted, free?, cadence)
router.get('/', (req, res) => res.json(sources.list()));

// POST /api/sources/:key/run — fetch + geo-filter + enrich + persist for the caller
router.post('/:key/run', runLimiter, async (req, res) => {
  try {
    const r = await sources.ingest(req.params.key, { userId: req.user.id, since: req.body?.since || null });
    res.json(r);
  } catch (e) {
    if (e instanceof SpendCapError) return res.status(402).json({ error: e.message });
    res.status(e.status || 500).json({ error: e.message });
  }
});

module.exports = router;
