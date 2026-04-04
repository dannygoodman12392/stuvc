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

// GET /api/founders/:founderId/memos — list all memos for a founder
router.get('/:founderId', (req, res) => {
  const memos = db.prepare('SELECT * FROM founder_memos WHERE founder_id = ? ORDER BY created_at DESC').all(req.params.founderId);
  res.json(memos);
});

// POST /api/founders/:founderId/memos — generate a new IC memo
router.post('/:founderId', async (req, res) => {
  const client = getAnthropicClient();
  if (!client) return res.status(503).json({ error: 'AI unavailable' });

  const founderId = parseInt(req.params.founderId);
  const founder = db.prepare('SELECT * FROM founders WHERE id = ? AND is_deleted = 0').get(founderId);
  if (!founder) return res.status(404).json({ error: 'Founder not found' });

  // Get existing memo count for versioning
  const memoCount = db.prepare('SELECT COUNT(*) as count FROM founder_memos WHERE founder_id = ?').get(founderId).count;
  const version = memoCount + 1;

  // Gather ALL data about this founder
  const notes = db.prepare('SELECT content, created_at FROM founder_notes WHERE founder_id = ? ORDER BY created_at DESC').all(founderId);
  const calls = db.prepare('SELECT structured_summary, raw_transcript, created_at FROM call_logs WHERE founder_id = ? ORDER BY created_at DESC').all(founderId);
  const assessments = db.prepare(`
    SELECT a.*, av.change_summary
    FROM opportunity_assessments a
    LEFT JOIN assessment_versions av ON av.assessment_id = a.id
    WHERE a.founder_id = ? AND a.is_deleted = 0 AND a.status = 'complete'
    ORDER BY a.created_at DESC
  `).all(founderId);
  const deals = db.prepare('SELECT * FROM deal_room WHERE founder_id = ? ORDER BY created_at DESC').all(founderId);
  const files = db.prepare('SELECT file_name, file_type, content_text, url FROM founder_files WHERE founder_id = ? ORDER BY created_at DESC').all(founderId);

  // Build comprehensive context
  let context = `FOUNDER PROFILE:
Name: ${founder.name}
Company: ${founder.company || 'N/A'}
Role: ${founder.role || 'Founder'}
Location: ${founder.location_city || ''} ${founder.location_state || ''}
Stage: ${founder.stage || 'Pre-seed'}
Domain: ${founder.domain || 'N/A'}
One-liner: ${founder.company_one_liner || 'N/A'}
LinkedIn: ${founder.linkedin_url || 'N/A'}
Bio: ${founder.bio || 'N/A'}
Previous Companies: ${founder.previous_companies || 'N/A'}
Notable Background: ${founder.notable_background || 'N/A'}
Chicago Connection: ${founder.chicago_connection || 'N/A'}
Source: ${founder.source || 'N/A'}
Fit Score: ${founder.fit_score || 'Not scored'}/10
Fit Rationale: ${founder.fit_score_rationale || 'N/A'}`;

  // Deal data
  if (founder.deal_status || founder.valuation || founder.round_size) {
    context += `\n\nDEAL DATA:
Deal Status: ${founder.deal_status || 'N/A'}
Deal Lead: ${founder.deal_lead || 'N/A'}
Security Type: ${founder.security_type || 'N/A'}
Valuation: ${founder.valuation ? '$' + founder.valuation.toLocaleString() : 'N/A'}
Round Size: ${founder.round_size ? '$' + founder.round_size.toLocaleString() : 'N/A'}
Our Investment: ${founder.investment_amount ? '$' + founder.investment_amount.toLocaleString() : 'N/A'}
ARR: ${founder.arr ? '$' + founder.arr.toLocaleString() : 'N/A'}
Monthly Burn: ${founder.monthly_burn ? '$' + founder.monthly_burn.toLocaleString() : 'N/A'}
Runway: ${founder.runway_months ? founder.runway_months + ' months' : 'N/A'}
Diligence: ${founder.diligence_status || 'Not started'}`;
  }

  // Notes
  if (notes.length > 0) {
    context += '\n\nTEAM NOTES:';
    notes.forEach((n, i) => {
      context += `\n[${new Date(n.created_at).toLocaleDateString()}] ${n.content}`;
    });
  }

  // Call summaries
  if (calls.length > 0) {
    context += '\n\nCALL HISTORY:';
    calls.forEach((c, i) => {
      const summary = c.structured_summary ? JSON.parse(c.structured_summary) : null;
      if (summary) {
        context += `\n\n[Call ${i + 1} - ${new Date(c.created_at).toLocaleDateString()}]`;
        if (summary.one_liner) context += `\nSummary: ${summary.one_liner}`;
        if (summary.signal) context += `\nSignal: ${summary.signal}`;
        if (summary.key_points) context += `\nKey Points: ${summary.key_points.join('; ')}`;
        if (summary.next_steps) context += `\nNext Steps: ${summary.next_steps.join('; ')}`;
        if (summary.concerns) context += `\nConcerns: ${summary.concerns.join('; ')}`;
      } else if (c.raw_transcript) {
        context += `\n\n[Call ${i + 1} - ${new Date(c.created_at).toLocaleDateString()}]\n${c.raw_transcript.slice(0, 3000)}`;
      }
    });
  }

  // Assessment outputs
  if (assessments.length > 0) {
    const latest = assessments[0];
    context += '\n\nLATEST ASSESSMENT OUTPUTS:';
    context += `\nOverall Signal: ${latest.overall_signal || 'N/A'}`;

    if (latest.synthesis_output) {
      try {
        const syn = JSON.parse(latest.synthesis_output);
        if (syn.executive_summary) context += `\nExecutive Summary: ${syn.executive_summary}`;
        if (syn.signal_scores) context += `\nScores: Founder ${syn.signal_scores.founder}/10, Market ${syn.signal_scores.market}/10, Economics ${syn.signal_scores.economics}/10, Pattern ${syn.signal_scores.pattern_fit}/10, Risk ${syn.signal_scores.risk_profile}/10`;
        if (syn.agent_consensus) context += `\nConsensus: ${syn.agent_consensus.join('; ')}`;
        if (syn.agent_disagreements) context += `\nDisagreements: ${syn.agent_disagreements.join('; ')}`;
        if (syn.top_questions) context += `\nOpen Questions: ${syn.top_questions.join('; ')}`;
      } catch {}
    }

    // Include individual agent outputs for depth
    const agentFields = ['founder_agent_output', 'market_agent_output', 'economics_agent_output', 'pattern_agent_output', 'bear_agent_output'];
    for (const field of agentFields) {
      if (latest[field]) {
        try {
          const output = JSON.parse(latest[field]);
          const label = field.replace('_agent_output', '').toUpperCase();
          if (output.narrative) context += `\n\n${label} AGENT NARRATIVE:\n${output.narrative}`;
          if (output.key_questions) context += `\nKey Questions: ${output.key_questions.join('; ')}`;
        } catch {}
      }
    }
  }

  // Uploaded files content
  if (files.length > 0) {
    context += '\n\nUPLOADED DOCUMENTS:';
    files.forEach(f => {
      context += `\n\n[${f.file_name}]`;
      if (f.content_text) context += `\n${f.content_text.slice(0, 5000)}`;
      if (f.url) context += `\nSource: ${f.url}`;
    });
  }

  // Cap context
  context = context.slice(0, 120000);

  // Create a placeholder memo record immediately
  const insertResult = db.prepare(
    'INSERT INTO founder_memos (founder_id, memo_type, content, version, data_snapshot, created_by) VALUES (?, ?, ?, ?, ?, ?)'
  ).run(founderId, 'ic_memo', '', version, JSON.stringify({ notes: notes.length, calls: calls.length, assessments: assessments.length, files: files.length }), req.user.id);
  const memoId = insertResult.lastInsertRowid;

  res.json({ id: memoId, version, status: 'generating' });

  // Generate memo in background
  try {
    const response = await client.messages.create({
      model: 'claude-sonnet-4-20250514',
      max_tokens: 8192,
      system: `You are the IC Memo Writer for Superior Studios, a Chicago-based pre-seed venture fund (~$10M Fund I).

You write investment committee memos that are direct, evidence-based, and intellectually honest. Your memos are the primary decision document for the investment committee (Brandon Cruz, Managing Partner).

MEMO STRUCTURE:
1. **Executive Summary** — 3-4 sentences: what the company does, why it matters, and the investment recommendation
2. **Company Overview** — What they build, for whom, how it works, current stage
3. **Founder Assessment** — Deep dive on the founder: background, traits (Speed/Storytelling/Salesmanship/Build+Motivate), stage classification (Freshman/Sophomore/Junior/Senior), founding insight type (Earned Insider vs Synthesized)
4. **Market Opportunity** — TAM/SAM/SOM, Why Now, competitive landscape, market timing
5. **Business Model & Unit Economics** — Revenue model, pricing, current metrics (if any), path to unit economics
6. **Competitive Advantage & Moat** — What's defensible? Apply Hamilton Helmer's 7 Powers where relevant
7. **Key Risks & Mitigants** — Top 3-5 risks with severity and what would mitigate them
8. **Investment Terms** — Round details, valuation, our check size, ownership
9. **Portfolio Fit** — How this fits the Superior Studios thesis and existing portfolio
10. **Recommendation** — Clear: Commit / Continue Diligence / Pass, with reasoning

STYLE:
- Be direct. No filler, no "this is an exciting opportunity."
- Lead with evidence, not opinion.
- Flag what you DON'T know — data gaps matter.
- Use the frameworks Danny's team uses: Eniac dimensions, Gurley unit economics, Marks risk asymmetry, Munger mental models, Helmer 7 Powers.
- Write for an audience of experienced investors who want signal, not noise.

Return the memo as clean markdown text (no JSON wrapping). Use ## headers for each section.`,
      messages: [{
        role: 'user',
        content: `Generate a comprehensive IC memo for this opportunity. Use ALL the data provided — notes, calls, assessments, documents. Be thorough but concise. Flag gaps where data is missing.\n\n${context}`
      }]
    });

    const memoContent = response.content[0].text.trim();
    db.prepare('UPDATE founder_memos SET content = ? WHERE id = ?').run(memoContent, memoId);

    // Also update the founder's memo_status
    db.prepare("UPDATE founders SET memo_status = 'Complete', updated_at = CURRENT_TIMESTAMP WHERE id = ? AND (memo_status IS NULL OR memo_status != 'Complete')").run(founderId);
  } catch (err) {
    console.error('[Memo] Generation error:', err);
    db.prepare("UPDATE founder_memos SET content = ? WHERE id = ?").run(`Error generating memo: ${err.message}`, memoId);
  }
});

// DELETE /api/founders/:founderId/memos/:id
router.delete('/:founderId/:id', (req, res) => {
  const memo = db.prepare('SELECT * FROM founder_memos WHERE id = ? AND founder_id = ?').get(req.params.id, req.params.founderId);
  if (!memo) return res.status(404).json({ error: 'Memo not found' });
  db.prepare('DELETE FROM founder_memos WHERE id = ?').run(req.params.id);
  res.json({ message: 'Memo deleted' });
});

module.exports = router;
