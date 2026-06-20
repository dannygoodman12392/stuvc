/**
 * routes/discover.js — /api/discover (web-session authed).
 * Active discovery for the web UI: go find fresh unicorn-builder profiles from the web by
 * signal. Runs on the user's Exa key + spend cap. Same engine the MCP discover_builders
 * tool and active monitors use.
 */
const express = require('express');
const router = express.Router();
const { discover, NoKeyError } = require('../pipeline/discovery-engine');
const { SpendCapError } = require('../lib/providerKeys');

// POST /api/discover  { signals?, query?, target?: 'sourcing'|'talent', limit? }
router.post('/', async (req, res) => {
  const { signals, query, target, limit } = req.body || {};
  try {
    const r = await discover({
      userId: req.user.id,
      signals: Array.isArray(signals) && signals.length ? signals : ['just_departed'],
      query: query || '',
      target: target === 'talent' ? 'talent' : 'sourcing',
      limit: Math.min(parseInt(limit) || 25, 50),
    });
    res.json({ found: r.matched.length, saved: r.persisted, queries: r.queries, results: r.matched });
  } catch (e) {
    if (e instanceof NoKeyError) return res.status(400).json({ error: e.message, code: 'no_key', provider: e.provider });
    if (e instanceof SpendCapError) return res.status(402).json({ error: e.message, code: 'spend_cap_exceeded' });
    res.status(500).json({ error: e.message });
  }
});

module.exports = router;
