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

// GET /api/assessments
router.get('/', (req, res) => {
  const assessments = db.prepare(`
    SELECT a.*, f.name as founder_name, f.company as founder_company
    FROM opportunity_assessments a
    LEFT JOIN founders f ON a.founder_id = f.id
    ORDER BY a.created_at DESC
  `).all();
  res.json(assessments);
});

// GET /api/assessments/:id
router.get('/:id', (req, res) => {
  const assessment = db.prepare(`
    SELECT a.*, f.name as founder_name, f.company as founder_company
    FROM opportunity_assessments a
    LEFT JOIN founders f ON a.founder_id = f.id
    WHERE a.id = ?
  `).get(req.params.id);
  if (!assessment) return res.status(404).json({ error: 'Assessment not found' });
  res.json(assessment);
});

// POST /api/assessments — create and run assessment
router.post('/', async (req, res) => {
  const { founder_id, inputs } = req.body;

  // Create assessment record
  const result = db.prepare('INSERT INTO opportunity_assessments (founder_id, inputs, status, created_by) VALUES (?, ?, ?, ?)').run(
    founder_id || null, JSON.stringify(inputs || {}), 'running', req.user.id
  );
  const assessmentId = result.lastInsertRowid;

  res.json({ id: assessmentId, status: 'running' });

  // Run agents in background
  runAssessmentAgents(assessmentId, inputs, founder_id).catch(err => {
    console.error('Assessment error:', err);
    db.prepare('UPDATE opportunity_assessments SET status = ? WHERE id = ?').run('error', assessmentId);
  });
});

async function runAssessmentAgents(assessmentId, inputs, founderId) {
  const client = getAnthropicClient();
  if (!client) {
    db.prepare("UPDATE opportunity_assessments SET status = 'error' WHERE id = ?").run(assessmentId);
    return;
  }

  // Build context from all inputs
  let context = '';
  if (inputs.deck_text) context += `\n\n--- PITCH DECK ---\n${inputs.deck_text}`;
  if (inputs.transcript) context += `\n\n--- MEETING TRANSCRIPT ---\n${inputs.transcript}`;
  if (inputs.website_content) context += `\n\n--- COMPANY WEBSITE ---\n${inputs.website_content}`;
  if (inputs.manual_notes) context += `\n\n--- ANALYST NOTES ---\n${inputs.manual_notes}`;

  // Pull founder data if linked
  let founderContext = '';
  if (founderId) {
    const founder = db.prepare('SELECT * FROM founders WHERE id = ?').get(founderId);
    if (founder) {
      founderContext = `\nFounder: ${founder.name}\nCompany: ${founder.company || 'Unknown'}\nRole: ${founder.role || 'Founder'}\nLocation: ${founder.location_city || ''} ${founder.location_state || ''}\nStage: ${founder.stage || 'Pre-seed'}\nDomain: ${founder.domain || 'Unknown'}\nLinkedIn: ${founder.linkedin_url || 'N/A'}\nBio: ${founder.bio || 'N/A'}\nPrevious companies: ${founder.previous_companies || 'N/A'}\nNotable background: ${founder.notable_background || 'N/A'}`;
    }
  }

  const fullContext = founderContext + context;

  // Run all 5 agents in parallel
  const agentPromises = [
    runAgent(client, 'founder', fullContext),
    runAgent(client, 'market', fullContext),
    runAgent(client, 'economics', fullContext),
    runAgent(client, 'pattern', fullContext),
    runAgent(client, 'bear', fullContext),
  ];

  const results = await Promise.allSettled(agentPromises);

  const agentOutputs = {
    founder: results[0].status === 'fulfilled' ? results[0].value : { error: results[0].reason?.message },
    market: results[1].status === 'fulfilled' ? results[1].value : { error: results[1].reason?.message },
    economics: results[2].status === 'fulfilled' ? results[2].value : { error: results[2].reason?.message },
    pattern: results[3].status === 'fulfilled' ? results[3].value : { error: results[3].reason?.message },
    bear: results[4].status === 'fulfilled' ? results[4].value : { error: results[4].reason?.message },
  };

  // Save agent outputs
  db.prepare(`UPDATE opportunity_assessments SET
    founder_agent_output = ?, market_agent_output = ?, economics_agent_output = ?,
    pattern_agent_output = ?, bear_agent_output = ?, status = 'synthesizing'
    WHERE id = ?
  `).run(
    JSON.stringify(agentOutputs.founder), JSON.stringify(agentOutputs.market),
    JSON.stringify(agentOutputs.economics), JSON.stringify(agentOutputs.pattern),
    JSON.stringify(agentOutputs.bear), assessmentId
  );

  // Run synthesis
  try {
    const synthesis = await runSynthesis(client, agentOutputs, fullContext);
    db.prepare(`UPDATE opportunity_assessments SET
      synthesis_output = ?, overall_signal = ?, status = 'complete', updated_at = CURRENT_TIMESTAMP
      WHERE id = ?
    `).run(JSON.stringify(synthesis), synthesis.overall_signal || 'watch', assessmentId);
  } catch (err) {
    console.error('Synthesis error:', err);
    db.prepare("UPDATE opportunity_assessments SET status = 'partial', updated_at = CURRENT_TIMESTAMP WHERE id = ?").run(assessmentId);
  }
}

const AGENT_PROMPTS = require('../agents/prompts');

async function runAgent(client, agentType, context) {
  const prompt = AGENT_PROMPTS[agentType];
  const response = await client.messages.create({
    model: 'claude-sonnet-4-20250514',
    max_tokens: 4096,
    system: prompt.system,
    messages: [{ role: 'user', content: prompt.user(context) }]
  });

  const text = response.content[0].text.trim();
  const jsonMatch = text.match(/\{[\s\S]*\}/);
  if (jsonMatch) return JSON.parse(jsonMatch[0]);
  return { raw: text, error: 'Could not parse JSON output' };
}

async function runSynthesis(client, agentOutputs, context) {
  const prompt = AGENT_PROMPTS.synthesis;
  const response = await client.messages.create({
    model: 'claude-sonnet-4-20250514',
    max_tokens: 4096,
    system: prompt.system,
    messages: [{ role: 'user', content: prompt.user(agentOutputs, context) }]
  });

  const text = response.content[0].text.trim();
  const jsonMatch = text.match(/\{[\s\S]*\}/);
  if (jsonMatch) return JSON.parse(jsonMatch[0]);
  return { raw: text, error: 'Could not parse synthesis' };
}

module.exports = router;
