const express = require('express');
const router = express.Router();
const db = require('../db');

function getAnthropicClient() {
  try {
    const apiKey = process.env.ANTHROPIC_API_KEY;
    if (!apiKey) return null;
    const Anthropic = require('@anthropic-ai/sdk');
    return new Anthropic({ apiKey });
  } catch {
    return null;
  }
}

const DANNY_AI_SYSTEM = `You are Danny AI, the venture intelligence layer for Superior Studios, a Chicago-based pre-seed venture fund with ~$10M Fund I.

You think through the lens of:
- Bill Gurley: unit economics, market structure, LTV/CAC, NRR, Rule of 40, marketplace dynamics
- Howard Marks: risk asymmetry, pattern recognition, anti-pattern awareness, second-level thinking
- Charlie Munger: mental models, incentive mapping, inversion, latticework thinking
- Hamilton Helmer: 7 Powers (scale economies, network effects, counter-positioning, switching costs, branding, cornered resource, process power)
- Eniac Ventures: founder evaluation (10 dimensions), Freshman/Senior framework
- Patrick O'Shaughnessy: long-term compounding, business quality signals

Superior Studios' investment philosophy:
- Pre-seed, Chicago/Midwest focus
- Four required founder traits: Speed, Storytelling, Salesmanship, Build+Motivate (all four required)
- Five active investment patterns:
  1. Founder-market fit requires lived insider experience
  2. Proprietary data or distribution creates the moat
  3. All four founder traits must be present
  4. Chicago founder preferred, or strong Chicago reason-to-be
  5. Market timing confirmed by Why Now scorecard
- Artist Founder thesis: at pre-seed, vision + judgment + recruiting ability is the scarce asset

The team: Brandon Cruz (Managing Partner), Eric Hutt (VP), Rob Schinske (Senior Associate), Danny Goodman (Strategic Initiatives, your primary user).

Be direct, specific, and intellectually honest. Never give generic VC framework answers. Apply frameworks to the specific deal or question in front of you.
Never start a response with "Great question" or any sycophantic opener.`;

// POST /api/ai/chat — streaming Danny AI
router.post('/chat', async (req, res) => {
  const client = getAnthropicClient();
  if (!client) return res.status(503).json({ error: 'AI unavailable — configure ANTHROPIC_API_KEY' });

  const { messages, context } = req.body;
  if (!messages || !messages.length) return res.status(400).json({ error: 'Messages required' });

  const systemPrompt = DANNY_AI_SYSTEM + (context ? `\n\n[CURRENT CONTEXT]\n${context}` : '');

  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');

  try {
    const stream = client.messages.stream({
      model: 'claude-sonnet-4-20250514',
      max_tokens: 4096,
      system: systemPrompt,
      messages: messages.map(m => ({ role: m.role, content: m.content }))
    });

    stream.on('text', (text) => {
      res.write(`data: ${JSON.stringify({ type: 'text', text })}\n\n`);
    });

    stream.on('end', () => {
      res.write(`data: ${JSON.stringify({ type: 'done' })}\n\n`);
      res.end();
    });

    stream.on('error', (err) => {
      res.write(`data: ${JSON.stringify({ type: 'error', error: err.message })}\n\n`);
      res.end();
    });

    req.on('close', () => {
      stream.abort();
    });
  } catch (err) {
    res.write(`data: ${JSON.stringify({ type: 'error', error: err.message })}\n\n`);
    res.end();
  }
});

// POST /api/ai/fit-score
router.post('/fit-score', async (req, res) => {
  const client = getAnthropicClient();
  if (!client) return res.status(503).json({ error: 'AI unavailable' });

  const { founderId } = req.body;
  const founder = db.prepare('SELECT * FROM founders WHERE id = ? AND is_deleted = 0 AND created_by = ?').get(founderId, req.user.id);
  if (!founder) return res.status(404).json({ error: 'Founder not found' });

  try {
    const response = await client.messages.create({
      model: 'claude-sonnet-4-20250514',
      max_tokens: 1024,
      system: `You are an investment analyst at Superior Studios, a Chicago-based pre-seed venture fund. Score founders on fit with the fund's thesis: Chicago/Midwest focus, B2B SaaS/AI/fintech/healthtech/marketplace, pre-seed stage, strong founder DNA (Speed, Storytelling, Salesmanship, Build+Motivate).`,
      messages: [{
        role: 'user',
        content: `Score this founder 1-10 on fit with Superior Studios. Return JSON only:
{
  "score": <1-10>,
  "rationale": "<2-3 sentences>",
  "strengths": ["..."],
  "concerns": ["..."]
}

Founder: ${founder.name}
Company: ${founder.company || 'N/A'}
Role: ${founder.role || 'Founder'}
Location: ${founder.location_city || ''} ${founder.location_state || ''}
Stage: ${founder.stage || 'Pre-seed'}
Domain: ${founder.domain || 'N/A'}
LinkedIn: ${founder.linkedin_url || 'N/A'}
Bio: ${founder.bio || 'N/A'}
Previous companies: ${founder.previous_companies || 'N/A'}
Notable background: ${founder.notable_background || 'N/A'}
Chicago connection: ${founder.chicago_connection || 'N/A'}`
      }]
    });

    const text = response.content[0].text.trim();
    const jsonMatch = text.match(/\{[\s\S]*\}/);
    if (jsonMatch) {
      const result = JSON.parse(jsonMatch[0]);
      // Save score to founder
      db.prepare('UPDATE founders SET fit_score = ?, fit_score_rationale = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ? AND created_by = ?').run(result.score, result.rationale, founderId, req.user.id);
      res.json(result);
    } else {
      res.status(500).json({ error: 'Could not parse AI response' });
    }
  } catch (err) {
    res.status(500).json({ error: 'AI request failed: ' + err.message });
  }
});

module.exports = router;
