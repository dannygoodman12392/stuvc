/**
 * routes/outreach.js — /api/outreach (web-session authed).
 * Draft a personalized outreach message to a saved person or raw profile. Same engine the
 * MCP draft_outreach tool uses. Runs on the user's Anthropic key.
 */
const express = require('express');
const router = express.Router();
const { draftOutreach, NoKeyError } = require('../pipeline/outreach');
const { getPerson } = require('../mcp/talentData');

// POST /api/outreach/draft  { candidateId?|founderId?|person?, intent?, context?, channel?, voice? }
router.post('/draft', async (req, res) => {
  const { candidateId, founderId, person, intent, context, channel, voice } = req.body || {};
  try {
    const p = (candidateId || founderId) ? getPerson(req.user.id, { candidateId, founderId }) : (person || {});
    if (!p || (!p.name && !p.headline)) return res.status(404).json({ error: 'Person not found — pass candidateId, founderId, or person fields.' });
    res.json(await draftOutreach(req.user.id, { person: p, intent, context, channel, voice }));
  } catch (e) {
    if (e instanceof NoKeyError || e.code === 'no_key') return res.status(400).json({ error: e.message, code: 'no_key' });
    res.status(500).json({ error: e.message });
  }
});

module.exports = router;
