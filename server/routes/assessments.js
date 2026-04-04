const express = require('express');
const router = express.Router();
const crypto = require('crypto');
const db = require('../db');
const runManager = require('../agents/runManager');
const { fetchUrlContent } = require('../agents/urlFetcher');

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

// ── GET /api/assessments — list all (grouped by latest version) ──
router.get('/', (req, res) => {
  const assessments = db.prepare(`
    SELECT a.*, f.name as founder_name, f.company as founder_company
    FROM opportunity_assessments a
    LEFT JOIN founders f ON a.founder_id = f.id
    WHERE a.is_deleted = 0
    ORDER BY a.created_at DESC
  `).all();
  res.json(assessments);
});

// ── GET /api/assessments/group/:groupId — all versions for an opportunity ──
router.get('/group/:groupId', (req, res) => {
  const versions = db.prepare(`
    SELECT a.*, f.name as founder_name, f.company as founder_company
    FROM opportunity_assessments a
    LEFT JOIN founders f ON a.founder_id = f.id
    WHERE a.group_id = ? AND a.is_deleted = 0
    ORDER BY a.version_number DESC
  `).all(req.params.groupId);

  // Attach change summaries from assessment_versions
  for (const v of versions) {
    const av = db.prepare('SELECT change_summary FROM assessment_versions WHERE assessment_id = ?').get(v.id);
    v.change_summary = av?.change_summary || null;
  }

  res.json(versions);
});

// ── GET /api/assessments/:id — single assessment with full data ──
router.get('/:id', (req, res) => {
  const assessment = db.prepare(`
    SELECT a.*, f.name as founder_name, f.company as founder_company
    FROM opportunity_assessments a
    LEFT JOIN founders f ON a.founder_id = f.id
    WHERE a.id = ? AND a.is_deleted = 0
  `).get(req.params.id);
  if (!assessment) return res.status(404).json({ error: 'Assessment not found' });
  res.json(assessment);
});

// ── GET /api/assessments/:id/inputs — all inputs for an assessment ──
router.get('/:id/inputs', (req, res) => {
  const inputs = db.prepare('SELECT * FROM assessment_inputs WHERE assessment_id = ? ORDER BY input_type, created_at').all(req.params.id);
  res.json(inputs);
});

// ── POST /api/assessments — create new assessment ──
// Accepts JSON body: { founder_id, group_id?, inputs: { decks[], transcripts[], urls[], notes[] } }
router.post('/', async (req, res) => {
  const { founder_id, group_id, inputs } = req.body;

  // Validate founder_id if provided
  const validFounderId = founder_id ? parseInt(founder_id) : null;
  if (validFounderId) {
    const founder = db.prepare('SELECT id FROM founders WHERE id = ?').get(validFounderId);
    if (!founder) return res.status(400).json({ error: 'Founder not found' });
  }

  // Determine group and version
  let gid = group_id;
  let versionNumber = 1;
  let previousAssessmentId = null;

  if (gid) {
    // Re-run: increment version
    const latest = db.prepare('SELECT id, version_number FROM opportunity_assessments WHERE group_id = ? AND is_deleted = 0 ORDER BY version_number DESC LIMIT 1').get(gid);
    if (latest) {
      versionNumber = latest.version_number + 1;
      previousAssessmentId = latest.id;
    }
  } else {
    gid = crypto.randomUUID();
  }

  // Create assessment record
  let result;
  try {
    result = db.prepare(`
      INSERT INTO opportunity_assessments (founder_id, inputs, status, group_id, version_number, created_by)
      VALUES (?, ?, 'processing_inputs', ?, ?, ?)
    `).run(validFounderId, JSON.stringify(inputs || {}), gid, versionNumber, req.user.id);
  } catch (err) {
    console.error('[Assessment] Insert error:', err);
    return res.status(500).json({ error: 'Failed to create assessment' });
  }
  const assessmentId = result.lastInsertRowid;

  // Create version record
  let changeSummary = null;
  if (previousAssessmentId) {
    const oldInputs = db.prepare('SELECT input_type, COUNT(*) as c FROM assessment_inputs WHERE assessment_id = ? GROUP BY input_type').all(previousAssessmentId);
    const oldMap = Object.fromEntries(oldInputs.map(i => [i.input_type, i.c]));
    const parts = [];
    if ((inputs.decks?.length || 0) > 0) parts.push(`+${inputs.decks.length} deck(s)`);
    if ((inputs.transcripts?.length || 0) > 0) parts.push(`+${inputs.transcripts.length} transcript(s)`);
    if ((inputs.urls?.length || 0) > 0) parts.push(`+${inputs.urls.length} URL(s)`);
    if ((inputs.notes?.length || 0) > 0) parts.push(`+${inputs.notes.length} note(s)`);
    changeSummary = parts.length > 0 ? `v${versionNumber}: ${parts.join(', ')}` : `v${versionNumber}: re-run with same inputs`;
  }

  db.prepare('INSERT INTO assessment_versions (group_id, assessment_id, version_number, change_summary, previous_assessment_id) VALUES (?, ?, ?, ?, ?)').run(
    gid, assessmentId, versionNumber, changeSummary, previousAssessmentId
  );

  res.json({ id: assessmentId, group_id: gid, version_number: versionNumber, status: 'processing_inputs' });

  // Process inputs and run agents in background
  processInputsAndRun(assessmentId, inputs || {}, validFounderId, previousAssessmentId).catch(err => {
    console.error('[Assessment] Error:', err);
    db.prepare("UPDATE opportunity_assessments SET status = 'error' WHERE id = ?").run(assessmentId);
  });
});

// ── PUT /api/assessments/:id — update metadata ──
router.put('/:id', (req, res) => {
  const assessment = db.prepare('SELECT * FROM opportunity_assessments WHERE id = ? AND is_deleted = 0').get(req.params.id);
  if (!assessment) return res.status(404).json({ error: 'Assessment not found' });

  const { founder_id, manual_notes } = req.body;

  if (founder_id !== undefined) {
    db.prepare('UPDATE opportunity_assessments SET founder_id = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?').run(founder_id || null, req.params.id);
  }

  // Allow adding/editing notes on an existing assessment
  if (manual_notes !== undefined) {
    // Update the inputs JSON
    const currentInputs = JSON.parse(assessment.inputs || '{}');
    currentInputs.manual_notes = manual_notes;
    db.prepare('UPDATE opportunity_assessments SET inputs = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?').run(JSON.stringify(currentInputs), req.params.id);
  }

  const updated = db.prepare('SELECT a.*, f.name as founder_name, f.company as founder_company FROM opportunity_assessments a LEFT JOIN founders f ON a.founder_id = f.id WHERE a.id = ?').get(req.params.id);
  res.json(updated);
});

// ── DELETE /api/assessments/:id — soft delete ──
router.delete('/:id', (req, res) => {
  const assessment = db.prepare('SELECT * FROM opportunity_assessments WHERE id = ? AND is_deleted = 0').get(req.params.id);
  if (!assessment) return res.status(404).json({ error: 'Assessment not found' });

  // Cancel if running
  if (assessment.status === 'running' || assessment.status === 'synthesizing') {
    runManager.cancel(assessment.id);
  }

  db.prepare('UPDATE opportunity_assessments SET is_deleted = 1, updated_at = CURRENT_TIMESTAMP WHERE id = ?').run(req.params.id);
  res.json({ message: 'Assessment deleted' });
});

// ── POST /api/assessments/:id/cancel — cancel running assessment ──
router.post('/:id/cancel', (req, res) => {
  const assessment = db.prepare('SELECT * FROM opportunity_assessments WHERE id = ?').get(req.params.id);
  if (!assessment) return res.status(404).json({ error: 'Assessment not found' });

  if (assessment.status !== 'running' && assessment.status !== 'synthesizing' && assessment.status !== 'processing_inputs') {
    return res.status(400).json({ error: 'Assessment is not running' });
  }

  runManager.cancel(assessment.id);
  db.prepare("UPDATE opportunity_assessments SET status = 'cancelled', cancelled_at = CURRENT_TIMESTAMP WHERE id = ?").run(req.params.id);
  res.json({ message: 'Assessment cancelled' });
});

// ── POST /api/assessments/:id/rerun — re-run with additional inputs ──
router.post('/:id/rerun', async (req, res) => {
  const assessment = db.prepare('SELECT * FROM opportunity_assessments WHERE id = ? AND is_deleted = 0').get(req.params.id);
  if (!assessment) return res.status(404).json({ error: 'Assessment not found' });

  const { inputs: newInputs } = req.body;
  const gid = assessment.group_id || crypto.randomUUID();
  const versionNumber = (assessment.version_number || 1) + 1;

  // Merge: carry forward founder_id, combine old inputs with new
  const result = db.prepare(`
    INSERT INTO opportunity_assessments (founder_id, inputs, status, group_id, version_number, created_by)
    VALUES (?, ?, 'processing_inputs', ?, ?, ?)
  `).run(assessment.founder_id, JSON.stringify(newInputs || {}), gid, versionNumber, req.user.id);
  const newId = result.lastInsertRowid;

  // Build change summary
  const parts = [];
  if ((newInputs?.decks?.length || 0) > 0) parts.push(`+${newInputs.decks.length} deck(s)`);
  if ((newInputs?.transcripts?.length || 0) > 0) parts.push(`+${newInputs.transcripts.length} transcript(s)`);
  if ((newInputs?.urls?.length || 0) > 0) parts.push(`+${newInputs.urls.length} URL(s)`);
  if ((newInputs?.notes?.length || 0) > 0) parts.push(`+${newInputs.notes.length} note(s)`);
  const changeSummary = parts.length > 0 ? `v${versionNumber}: ${parts.join(', ')}` : `v${versionNumber}: re-run`;

  db.prepare('INSERT INTO assessment_versions (group_id, assessment_id, version_number, change_summary, previous_assessment_id) VALUES (?, ?, ?, ?, ?)').run(
    gid, newId, versionNumber, changeSummary, assessment.id
  );

  // Also update original assessment's group_id if it didn't have one
  if (!assessment.group_id) {
    db.prepare('UPDATE opportunity_assessments SET group_id = ? WHERE id = ?').run(gid, assessment.id);
    // Create a version record for the original too
    db.prepare('INSERT OR IGNORE INTO assessment_versions (group_id, assessment_id, version_number, change_summary) VALUES (?, ?, 1, ?)').run(gid, assessment.id, 'v1: Initial assessment');
  }

  res.json({ id: newId, group_id: gid, version_number: versionNumber, status: 'processing_inputs' });

  // Copy old inputs, add new, then run
  processRerunInputs(newId, assessment.id, newInputs, assessment.founder_id).catch(err => {
    console.error('[Assessment] Rerun error:', err);
    db.prepare("UPDATE opportunity_assessments SET status = 'error' WHERE id = ?").run(newId);
  });
});

// ════════════════════════════════════════════════════════
// Background processing
// ════════════════════════════════════════════════════════

async function processInputsAndRun(assessmentId, inputs, founderId, previousAssessmentId) {
  const insertInput = db.prepare('INSERT INTO assessment_inputs (assessment_id, input_type, label, content, source_url, file_name) VALUES (?, ?, ?, ?, ?, ?)');

  // Process deck text entries
  if (inputs.decks && Array.isArray(inputs.decks)) {
    for (const deck of inputs.decks) {
      insertInput.run(assessmentId, 'deck', deck.label || 'Pitch Deck', deck.content, null, deck.fileName || null);
    }
  }
  // Legacy: single deck_text
  if (inputs.deck_text) {
    insertInput.run(assessmentId, 'deck', 'Pitch Deck', inputs.deck_text, null, null);
  }

  // Process transcripts
  if (inputs.transcripts && Array.isArray(inputs.transcripts)) {
    for (const t of inputs.transcripts) {
      insertInput.run(assessmentId, 'transcript', t.label || 'Call Transcript', t.content, null, null);
    }
  }
  // Legacy: single transcript
  if (inputs.transcript) {
    insertInput.run(assessmentId, 'transcript', 'Call Transcript', inputs.transcript, null, null);
  }

  // Process notes
  if (inputs.notes && Array.isArray(inputs.notes)) {
    for (const n of inputs.notes) {
      insertInput.run(assessmentId, 'notes', n.label || 'Analyst Notes', n.content, null, null);
    }
  }
  // Legacy: single manual_notes
  if (inputs.manual_notes) {
    insertInput.run(assessmentId, 'notes', 'Analyst Notes', inputs.manual_notes, null, null);
  }

  // Fetch URLs
  if (inputs.urls && Array.isArray(inputs.urls)) {
    for (const url of inputs.urls) {
      const urlStr = typeof url === 'string' ? url : url.url;
      if (!urlStr) continue;
      console.log(`[Assessment] Fetching URL: ${urlStr}`);
      const fetched = await fetchUrlContent(urlStr);
      if (fetched.error) {
        console.warn(`[Assessment] URL fetch failed for ${urlStr}: ${fetched.error}`);
        insertInput.run(assessmentId, 'url', `${fetched.title || urlStr} (fetch failed)`, `Failed to fetch: ${fetched.error}`, urlStr, null);
      } else {
        insertInput.run(assessmentId, 'url', fetched.title || urlStr, fetched.text, urlStr, null);
      }
    }
  }
  // Legacy: single website_content
  if (inputs.website_content) {
    insertInput.run(assessmentId, 'url', 'Company Website', inputs.website_content, null, null);
  }

  // Now build context and run agents
  db.prepare("UPDATE opportunity_assessments SET status = 'running' WHERE id = ?").run(assessmentId);
  await runAssessmentAgents(assessmentId, founderId);
}

async function processRerunInputs(newAssessmentId, oldAssessmentId, newInputs, founderId) {
  const insertInput = db.prepare('INSERT INTO assessment_inputs (assessment_id, input_type, label, content, source_url, file_name) VALUES (?, ?, ?, ?, ?, ?)');

  // Copy all inputs from previous assessment
  const oldInputs = db.prepare('SELECT * FROM assessment_inputs WHERE assessment_id = ?').all(oldAssessmentId);
  for (const inp of oldInputs) {
    insertInput.run(newAssessmentId, inp.input_type, inp.label, inp.content, inp.source_url, inp.file_name);
  }

  // Add new inputs on top
  await processInputsAndRun(newAssessmentId, newInputs || {}, founderId, oldAssessmentId);
}

async function runAssessmentAgents(assessmentId, founderId) {
  const client = getAnthropicClient();
  if (!client) {
    db.prepare("UPDATE opportunity_assessments SET status = 'error' WHERE id = ?").run(assessmentId);
    return;
  }

  const signal = runManager.register(assessmentId);

  try {
    // Build context from all assessment_inputs
    const allInputs = db.prepare('SELECT * FROM assessment_inputs WHERE assessment_id = ? ORDER BY input_type, id').all(assessmentId);

    let context = '';
    const inputsByType = {};
    for (const inp of allInputs) {
      if (!inputsByType[inp.input_type]) inputsByType[inp.input_type] = [];
      inputsByType[inp.input_type].push(inp);
    }

    // Structured context assembly
    if (inputsByType.deck) {
      for (let i = 0; i < inputsByType.deck.length; i++) {
        const d = inputsByType.deck[i];
        context += `\n\n--- PITCH DECK ${i + 1}: ${d.label || d.file_name || 'Untitled'} ---\n${d.content}`;
      }
    }
    if (inputsByType.transcript) {
      for (let i = 0; i < inputsByType.transcript.length; i++) {
        const t = inputsByType.transcript[i];
        context += `\n\n--- CALL TRANSCRIPT ${i + 1}: ${t.label || 'Meeting Notes'} ---\n${t.content}`;
      }
    }
    if (inputsByType.url) {
      for (let i = 0; i < inputsByType.url.length; i++) {
        const u = inputsByType.url[i];
        context += `\n\n--- WEBSITE${u.source_url ? ': ' + u.source_url : ''} ---\n${u.content}`;
      }
    }
    if (inputsByType.notes) {
      for (let i = 0; i < inputsByType.notes.length; i++) {
        const n = inputsByType.notes[i];
        context += `\n\n--- ANALYST NOTES ${i + 1}: ${n.label || ''} ---\n${n.content}`;
      }
    }

    // Pull founder data if linked
    let founderContext = '';
    if (founderId) {
      const founder = db.prepare('SELECT * FROM founders WHERE id = ?').get(founderId);
      if (founder) {
        founderContext = `\nFounder: ${founder.name}\nCompany: ${founder.company || 'Unknown'}\nRole: ${founder.role || 'Founder'}\nLocation: ${founder.location_city || ''} ${founder.location_state || ''}\nStage: ${founder.stage || 'Pre-seed'}\nDomain: ${founder.domain || 'Unknown'}\nLinkedIn: ${founder.linkedin_url || 'N/A'}\nBio: ${founder.bio || 'N/A'}\nPrevious companies: ${founder.previous_companies || 'N/A'}\nNotable background: ${founder.notable_background || 'N/A'}`;

        // Also pull call logs and notes for this founder
        const calls = db.prepare('SELECT structured_summary, raw_transcript FROM call_logs WHERE founder_id = ? ORDER BY created_at DESC LIMIT 5').all(founderId);
        if (calls.length > 0) {
          for (let i = 0; i < calls.length; i++) {
            const call = calls[i];
            const text = call.structured_summary || call.raw_transcript;
            if (text) context += `\n\n--- PREVIOUS CALL ${i + 1} (from CRM) ---\n${text}`;
          }
        }

        const notes = db.prepare('SELECT content FROM founder_notes WHERE founder_id = ? ORDER BY created_at DESC LIMIT 10').all(founderId);
        if (notes.length > 0) {
          context += `\n\n--- CRM NOTES ---\n${notes.map(n => n.content).join('\n---\n')}`;
        }
      }
    }

    // Cap context to ~150K chars to stay within limits
    const fullContext = founderContext + context;
    const cappedContext = fullContext.slice(0, 150000);
    if (fullContext.length > 150000) {
      console.warn(`[Assessment] Context truncated from ${fullContext.length} to 150K chars`);
    }

    // Run all 5 agents in parallel
    const AGENT_PROMPTS = require('../agents/prompts');

    const agentPromises = [
      runAgent(client, AGENT_PROMPTS.founder, cappedContext, signal),
      runAgent(client, AGENT_PROMPTS.market, cappedContext, signal),
      runAgent(client, AGENT_PROMPTS.economics, cappedContext, signal),
      runAgent(client, AGENT_PROMPTS.pattern, cappedContext, signal),
      runAgent(client, AGENT_PROMPTS.bear, cappedContext, signal),
    ];

    const results = await Promise.allSettled(agentPromises);

    if (signal.aborted) {
      console.log(`[Assessment] Run ${assessmentId} was cancelled`);
      return;
    }

    const agentOutputs = {
      founder: results[0].status === 'fulfilled' ? results[0].value : { error: results[0].reason?.message || 'Agent failed' },
      market: results[1].status === 'fulfilled' ? results[1].value : { error: results[1].reason?.message || 'Agent failed' },
      economics: results[2].status === 'fulfilled' ? results[2].value : { error: results[2].reason?.message || 'Agent failed' },
      pattern: results[3].status === 'fulfilled' ? results[3].value : { error: results[3].reason?.message || 'Agent failed' },
      bear: results[4].status === 'fulfilled' ? results[4].value : { error: results[4].reason?.message || 'Agent failed' },
    };

    // Save agent outputs — save each one individually for real-time polling visibility
    db.prepare(`UPDATE opportunity_assessments SET
      founder_agent_output = ?, market_agent_output = ?, economics_agent_output = ?,
      pattern_agent_output = ?, bear_agent_output = ?, status = 'synthesizing'
      WHERE id = ?
    `).run(
      JSON.stringify(agentOutputs.founder), JSON.stringify(agentOutputs.market),
      JSON.stringify(agentOutputs.economics), JSON.stringify(agentOutputs.pattern),
      JSON.stringify(agentOutputs.bear), assessmentId
    );

    if (signal.aborted) return;

    // Run synthesis
    try {
      const synthesis = await runSynthesis(client, AGENT_PROMPTS.synthesis, agentOutputs, cappedContext, signal);
      if (signal.aborted) return;

      db.prepare(`UPDATE opportunity_assessments SET
        synthesis_output = ?, overall_signal = ?, status = 'complete', updated_at = CURRENT_TIMESTAMP
        WHERE id = ?
      `).run(JSON.stringify(synthesis), synthesis.overall_signal || 'Watch', assessmentId);
    } catch (err) {
      if (signal.aborted) return;
      console.error('[Assessment] Synthesis error:', err);
      db.prepare("UPDATE opportunity_assessments SET status = 'partial', updated_at = CURRENT_TIMESTAMP WHERE id = ?").run(assessmentId);
    }
  } finally {
    runManager.cleanup(assessmentId);
  }
}

async function runAgent(client, prompt, context, signal) {
  const response = await client.messages.create({
    model: 'claude-sonnet-4-20250514',
    max_tokens: 4096,
    system: prompt.system,
    messages: [{ role: 'user', content: prompt.user(context) }],
    ...(signal ? {} : {}), // Note: AbortSignal support varies by SDK version
  });

  const text = response.content[0].text.trim();
  const jsonMatch = text.match(/\{[\s\S]*\}/);
  if (jsonMatch) return JSON.parse(jsonMatch[0]);
  return { raw: text, error: 'Could not parse JSON output' };
}

async function runSynthesis(client, prompt, agentOutputs, context, signal) {
  const response = await client.messages.create({
    model: 'claude-sonnet-4-20250514',
    max_tokens: 4096,
    system: prompt.system,
    messages: [{ role: 'user', content: prompt.user(agentOutputs, context) }],
  });

  const text = response.content[0].text.trim();
  const jsonMatch = text.match(/\{[\s\S]*\}/);
  if (jsonMatch) return JSON.parse(jsonMatch[0]);
  return { raw: text, error: 'Could not parse synthesis' };
}

module.exports = router;
