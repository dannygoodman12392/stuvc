#!/usr/bin/env node
/**
 * rescore-all.js
 * Creates new assessments for 6 companies using filesystem materials + CRM data.
 * Run from server/ directory: node scripts/rescore-all.js
 */

const path = require('path');
const fs = require('fs');
const crypto = require('crypto');

// Load .env from project root — must happen before any other requires that use env vars
const dotenvResult = require('dotenv').config({ path: path.resolve(__dirname, '../../.env'), override: true });
if (dotenvResult.error) {
  console.error('Failed to load .env:', dotenvResult.error.message);
}
console.log('ENV loaded, ANTHROPIC_API_KEY present:', !!process.env.ANTHROPIC_API_KEY);

if (!process.env.ANTHROPIC_API_KEY) {
  console.error('ANTHROPIC_API_KEY not set. Check .env file at:', path.resolve(__dirname, '../../.env'));
  process.exit(1);
}

const Anthropic = require('@anthropic-ai/sdk');
const db = require('../db');
const AGENT_PROMPTS = require('../agents/prompts');

const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

const CREATED_BY = 1; // Danny
const DEALS_DIR = '/Users/dannygoodman/Desktop/Claude/Superior Studios/1 - Active Deals';

// ══════════════════════════════════════════════════════════
// Scoring functions (updated for new rubric subcategories)
// ══════════════════════════════════════════════════════════

function round1(n) {
  return Math.round(n * 10) / 10;
}

function computeTeamPillarScore(subs) {
  if (!subs) return null;
  // founder_problem_fit and sales_capability carry 2x weight
  const weights = {
    founder_problem_fit: 2,
    sales_capability: 2,
    velocity: 1,
    storytelling_framing: 1,
    team_composition: 1,
    competitive_precision: 1,
    missionary_conviction: 1,
    // Legacy subcategories (in case the LLM returns old names)
    founder_market_fit: 1,
    idea_maze: 1,
    experience_stage_fit: 1,
  };
  let totalWeight = 0, totalScore = 0;
  for (const [key, w] of Object.entries(weights)) {
    const sub = subs[key];
    if (sub && typeof sub.score === 'number') {
      totalScore += sub.score * w;
      totalWeight += w;
    }
  }
  return totalWeight > 0 ? round1(totalScore / totalWeight) : null;
}

function computeProductPillarScore(subs) {
  if (!subs) return null;
  // product_velocity and customer_proximity carry 2x weight
  const weights = {
    product_velocity: 2,
    customer_proximity: 2,
    focus_prioritization: 1,
    moat_architecture: 1,
    flywheel_design: 1,
    // Legacy
    technical_defensibility: 1,
    product_market_intuition: 1,
  };
  let totalWeight = 0, totalScore = 0;
  for (const [key, w] of Object.entries(weights)) {
    const sub = subs[key];
    if (sub && typeof sub.score === 'number') {
      totalScore += sub.score * w;
      totalWeight += w;
    }
  }
  return totalWeight > 0 ? round1(totalScore / totalWeight) : null;
}

function computeMarketPillarScore(subs) {
  if (!subs) return null;
  // Simple average of all subcategories
  // Include neutral_layer_viability only if present and not null/N/A
  const scores = [];
  for (const [key, sub] of Object.entries(subs)) {
    if (!sub || typeof sub.score !== 'number') continue;
    if (key === 'neutral_layer_viability') {
      // Only include if the score is a real number and evidence isn't "N/A"
      const ev = (sub.evidence || '').trim();
      if (ev.toLowerCase() === 'n/a' || ev === '') continue;
      scores.push(sub.score);
    } else {
      scores.push(sub.score);
    }
  }
  if (scores.length === 0) return null;
  return round1(scores.reduce((a, b) => a + b, 0) / scores.length);
}

function correctPillarScores(agentOutputs) {
  // Team: weighted average
  if (agentOutputs.team && agentOutputs.team.subcategories) {
    const computed = computeTeamPillarScore(agentOutputs.team.subcategories);
    if (computed !== null) {
      agentOutputs.team.pillar_score = computed;
      if (agentOutputs.team.verdict) {
        agentOutputs.team.verdict.score = computed;
      }
    }
  }
  // Product: weighted average
  if (agentOutputs.product && agentOutputs.product.subcategories) {
    const computed = computeProductPillarScore(agentOutputs.product.subcategories);
    if (computed !== null) agentOutputs.product.pillar_score = computed;
  }
  // Market: simple average (with optional neutral_layer_viability)
  if (agentOutputs.market && agentOutputs.market.subcategories) {
    const computed = computeMarketPillarScore(agentOutputs.market.subcategories);
    if (computed !== null) agentOutputs.market.pillar_score = computed;
  }
  // Bear: clamp adjustment to [0, -1.5] with traction-based ceiling
  if (agentOutputs.bear && typeof agentOutputs.bear.bear_adjustment === 'number') {
    let bearAdj = Math.max(-1.5, Math.min(0, agentOutputs.bear.bear_adjustment));

    const teamPillar = agentOutputs.team?.pillar_score;
    const prodVelocity = agentOutputs.product?.subcategories?.product_velocity?.score;
    const prodProximity = agentOutputs.product?.subcategories?.customer_proximity?.score;

    if (teamPillar >= 7.5 && prodVelocity >= 7 && prodProximity >= 7) {
      bearAdj = Math.max(bearAdj, -0.5);
    } else if (teamPillar >= 7.0 && (prodVelocity >= 7 || prodProximity >= 7)) {
      bearAdj = Math.max(bearAdj, -0.8);
    }

    if (prodVelocity !== null && prodVelocity !== undefined && prodVelocity < 5) {
      bearAdj = Math.min(bearAdj, -0.7);
    }

    agentOutputs.bear.bear_adjustment = round1(bearAdj);
  }
}

function correctSynthesisScores(synthesis, agentOutputs) {
  const teamScore = agentOutputs.team?.pillar_score;
  const productScore = agentOutputs.product?.pillar_score;
  const marketScore = agentOutputs.market?.pillar_score;
  const bearAdj = agentOutputs.bear?.bear_adjustment ?? 0;

  synthesis.pillar_scores = { team: teamScore, product: productScore, market: marketScore };
  synthesis.bear_adjustment = bearAdj;

  const t = (teamScore || 0) * 0.45;
  const p = (productScore || 0) * 0.25;
  const m = (marketScore || 0) * 0.30;
  const raw = t + p + m + bearAdj;
  const overall = round1(raw);

  synthesis.overall_score = overall;
  synthesis.score_calculation = `(${teamScore} * 0.45) + (${productScore} * 0.25) + (${marketScore} * 0.30) + (${bearAdj}) = ${round1(t)} + ${round1(p)} + ${round1(m)} + ${bearAdj} = ${overall}`;

  let finalScore = overall;
  if (synthesis.override && typeof synthesis.override === 'object' && typeof synthesis.override.adjustment === 'number') {
    const adj = Math.max(-1, Math.min(1, synthesis.override.adjustment));
    finalScore = round1(overall + adj);
    synthesis.overall_score = finalScore;
    synthesis.score_calculation += ` -> override ${adj > 0 ? '+' : ''}${adj} = ${finalScore} (${synthesis.override.justification || 'no justification'})`;
  }

  synthesis.overall_signal = finalScore >= 7.0 ? 'Invest' : finalScore >= 5.0 ? 'Monitor' : 'Pass';
}

function robustJsonParse(text) {
  const jsonMatch = text.match(/\{[\s\S]*\}/);
  if (!jsonMatch) return null;
  let raw = jsonMatch[0];
  raw = raw.replace(/[\u201C\u201D]/g, '"').replace(/[\u2018\u2019]/g, "'");

  try { return JSON.parse(raw); } catch {}

  let fixed = raw.replace(/,\s*([}\]])/g, '$1');
  try { return JSON.parse(fixed); } catch {}

  fixed = fixed.replace(/[\x00-\x1F]/g, (ch) => {
    if (ch === '\n') return '\\n';
    if (ch === '\r') return '\\r';
    if (ch === '\t') return '\\t';
    return '';
  });
  try { return JSON.parse(fixed); } catch {}

  fixed = fixed.replace(/"([^"]*?)"/g, (match, content) => {
    const escaped = content.replace(/(?<!\\)"/g, '\\"');
    return `"${escaped}"`;
  });
  try { return JSON.parse(fixed); } catch (e) {
    console.error('[rescore] JSON parse failed:', e.message);
    return { error: e.message };
  }
}

// ══════════════════════════════════════════════════════════
// Agent runners
// ══════════════════════════════════════════════════════════

async function runAgent(prompt, context, retries = 1) {
  const response = await client.messages.create({
    model: 'claude-sonnet-4-20250514',
    max_tokens: 4096,
    system: prompt.system,
    messages: [{ role: 'user', content: prompt.user(context) }],
  });
  const text = response.content[0].text.trim();
  const parsed = robustJsonParse(text);
  if (parsed && !parsed.error) return parsed;
  if (retries > 0) {
    console.warn('  JSON parse failed, retrying...');
    return runAgent(prompt, context, retries - 1);
  }
  if (parsed) return parsed;
  return { raw: text, error: 'Could not parse JSON output' };
}

async function runSynthesis(agentOutputs, context) {
  const response = await client.messages.create({
    model: 'claude-sonnet-4-20250514',
    max_tokens: 4096,
    system: AGENT_PROMPTS.synthesis.system,
    messages: [{ role: 'user', content: AGENT_PROMPTS.synthesis.user(agentOutputs, context) }],
  });
  const text = response.content[0].text.trim();
  const parsed = robustJsonParse(text);
  return parsed || { raw: text, error: 'Could not parse synthesis' };
}

// ══════════════════════════════════════════════════════════
// Helpers
// ══════════════════════════════════════════════════════════

function readFileIfExists(filePath) {
  try {
    return fs.readFileSync(filePath, 'utf-8');
  } catch {
    console.warn(`  File not found: ${filePath}`);
    return null;
  }
}

function getFounderNotes(founderId) {
  if (!founderId) return [];
  return db.prepare('SELECT content FROM founder_notes WHERE founder_id = ? ORDER BY created_at DESC LIMIT 10').all(founderId);
}

function getFounderData(founderId) {
  if (!founderId) return null;
  return db.prepare('SELECT * FROM founders WHERE id = ?').get(founderId);
}

function buildFounderContext(founder) {
  if (!founder) return '';
  return `\nFounder: ${founder.name}\nCompany: ${founder.company || 'Unknown'}\nRole: ${founder.role || 'Founder'}\nLocation: ${founder.location_city || ''} ${founder.location_state || ''}\nStage: ${founder.stage || 'Pre-seed'}\nDomain: ${founder.domain || 'Unknown'}\nLinkedIn: ${founder.linkedin_url || 'N/A'}\nBio: ${founder.bio || 'N/A'}\nPrevious companies: ${founder.previous_companies || 'N/A'}\nNotable background: ${founder.notable_background || 'N/A'}`;
}

function buildContext(founderContext, files, notes) {
  let context = founderContext;
  for (const f of files) {
    context += `\n\n--- ${f.label} ---\n${f.content}`;
  }
  if (notes.length > 0) {
    context += `\n\n--- CRM NOTES ---\n${notes.map(n => n.content).join('\n---\n')}`;
  }
  // Cap at 150K chars
  if (context.length > 150000) {
    console.warn(`  Context truncated from ${context.length} to 150K chars`);
    context = context.slice(0, 150000);
  }
  return context;
}

function createAssessmentRecord(founderId) {
  const groupId = crypto.randomUUID();
  const result = db.prepare(`
    INSERT INTO opportunity_assessments (founder_id, inputs, status, group_id, version_number, created_by)
    VALUES (?, '{}', 'running', ?, 1, ?)
  `).run(founderId, groupId, CREATED_BY);
  const assessmentId = result.lastInsertRowid;
  db.prepare('INSERT INTO assessment_versions (group_id, assessment_id, version_number, change_summary) VALUES (?, ?, 1, ?)').run(
    groupId, assessmentId, 'v1: rescore-all batch run'
  );
  return assessmentId;
}

function saveInputs(assessmentId, files, notes) {
  const insert = db.prepare('INSERT INTO assessment_inputs (assessment_id, input_type, label, content) VALUES (?, ?, ?, ?)');
  for (const f of files) {
    insert.run(assessmentId, f.type || 'notes', f.label, f.content);
  }
  for (const n of notes) {
    insert.run(assessmentId, 'notes', 'CRM Note', n.content);
  }
}

function copyInputsFromAssessment(newAssessmentId, sourceAssessmentId) {
  const oldInputs = db.prepare('SELECT * FROM assessment_inputs WHERE assessment_id = ?').all(sourceAssessmentId);
  const insert = db.prepare('INSERT INTO assessment_inputs (assessment_id, input_type, label, content, source_url, file_name, mime_type) VALUES (?, ?, ?, ?, ?, ?, ?)');
  for (const inp of oldInputs) {
    insert.run(newAssessmentId, inp.input_type, inp.label, inp.content, inp.source_url, inp.file_name, inp.mime_type);
  }
  return oldInputs.length;
}

async function runFullAssessment(assessmentId, context) {
  console.log('  Running 4 agents in parallel...');
  const results = await Promise.allSettled([
    runAgent(AGENT_PROMPTS.team, context),
    runAgent(AGENT_PROMPTS.product, context),
    runAgent(AGENT_PROMPTS.market, context),
    runAgent(AGENT_PROMPTS.bear, context),
  ]);

  const agentOutputs = {
    team: results[0].status === 'fulfilled' ? results[0].value : { error: results[0].reason?.message || 'Agent failed' },
    product: results[1].status === 'fulfilled' ? results[1].value : { error: results[1].reason?.message || 'Agent failed' },
    market: results[2].status === 'fulfilled' ? results[2].value : { error: results[2].reason?.message || 'Agent failed' },
    bear: results[3].status === 'fulfilled' ? results[3].value : { error: results[3].reason?.message || 'Agent failed' },
  };

  // Log any agent errors
  for (const [name, output] of Object.entries(agentOutputs)) {
    if (output.error) console.warn(`  WARNING: ${name} agent returned error: ${output.error}`);
  }

  // Deterministic score computation
  correctPillarScores(agentOutputs);

  console.log(`  Pillar scores - Team: ${agentOutputs.team?.pillar_score}, Product: ${agentOutputs.product?.pillar_score}, Market: ${agentOutputs.market?.pillar_score}, Bear: ${agentOutputs.bear?.bear_adjustment}`);

  // Save agent outputs
  db.prepare(`UPDATE opportunity_assessments SET
    founder_agent_output = ?, market_agent_output = ?, economics_agent_output = ?,
    pattern_agent_output = NULL, bear_agent_output = ?, status = 'synthesizing'
    WHERE id = ?
  `).run(
    JSON.stringify(agentOutputs.team), JSON.stringify(agentOutputs.product),
    JSON.stringify(agentOutputs.market), JSON.stringify(agentOutputs.bear),
    assessmentId
  );

  // Run synthesis
  console.log('  Running synthesis...');
  const synthesis = await runSynthesis(agentOutputs, context);
  correctSynthesisScores(synthesis, agentOutputs);

  console.log(`  Overall: ${synthesis.overall_score} (${synthesis.overall_signal})`);

  db.prepare(`UPDATE opportunity_assessments SET
    synthesis_output = ?, overall_signal = ?, status = 'complete', updated_at = CURRENT_TIMESTAMP
    WHERE id = ?
  `).run(JSON.stringify(synthesis), synthesis.overall_signal || 'Monitor', assessmentId);

  return { agentOutputs, synthesis };
}

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

// ══════════════════════════════════════════════════════════
// Company definitions
// ══════════════════════════════════════════════════════════

const companies = [
  {
    name: 'Gil',
    founderId: 5203,
    files: [
      { label: 'Deal Memo - Gil', path: `${DEALS_DIR}/Gil/deal-memo-gil.md`, type: 'notes' },
      { label: 'Founder Assessment - Ashtyn Bell', path: `${DEALS_DIR}/Gil/founder-assessment-ashtyn-bell.md`, type: 'notes' },
    ],
    useCrmNotes: true,
  },
  {
    name: 'Hale',
    founderId: 5084,
    files: [],
    useCrmNotes: true,
  },
  {
    name: 'Ghost Social',
    founderId: 5202,
    files: [],
    useCrmNotes: true,
  },
  {
    name: 'Kya Labs',
    founderId: 5465,
    files: [
      { label: 'Deal Memo - Kya Labs (2026-04-09)', path: `${DEALS_DIR}/Kya Labs/Deal_Memo_Kya_Labs_2026-04-09.md`, type: 'notes' },
      { label: 'Meeting Notes - James Sharp (2026-03-30)', path: `${DEALS_DIR}/Kya Labs/Meeting_Notes_James_Sharp_2026-03-30.md`, type: 'transcript' },
      { label: 'Deck Analysis - Kya Labs (2026-04-08)', path: `${DEALS_DIR}/Kya Labs/Kya_Labs_Deck_Analysis_2026-04-08.md`, type: 'deck' },
    ],
    useCrmNotes: false,
  },
  {
    name: 'The Graph',
    founderId: null, // Will be created
    founderName: 'Marina Dedes Gallagher',
    files: [
      { label: 'Deal Memo - The Graph (2026-03-30)', path: `${DEALS_DIR}/the graph/Deal_Memo_The_Graph_2026-03-30.md`, type: 'notes' },
      { label: 'Thesis Check - The Graph (2026-03-30)', path: `${DEALS_DIR}/the graph/Thesis_Check_The_Graph_2026-03-30.md`, type: 'notes' },
      { label: 'Meeting Prep - Marina Dedes Gallagher (2026-03-30)', path: `${DEALS_DIR}/the graph/Meeting_Prep_Marina_Dedes_Gallagher_2026-03-30.md`, type: 'notes' },
    ],
    useCrmNotes: false,
    createFounder: true,
  },
  {
    name: 'Gatsby Robotics',
    founderId: 5372,
    files: [],
    useCrmNotes: false,
    copyFromAssessmentId: 4, // Copy inputs from existing assessment
  },
];

// ══════════════════════════════════════════════════════════
// Main
// ══════════════════════════════════════════════════════════

async function main() {
  console.log('=== Superior Studios Batch Rescore ===');
  console.log(`Processing ${companies.length} companies\n`);

  const results = [];

  for (let i = 0; i < companies.length; i++) {
    const company = companies[i];
    console.log(`\n[${ i + 1}/${companies.length}] ${company.name}`);
    console.log('─'.repeat(50));

    try {
      let founderId = company.founderId;

      // Create founder if needed (The Graph)
      if (company.createFounder) {
        console.log(`  Creating founder record for ${company.founderName}...`);
        const result = db.prepare(
          "INSERT INTO founders (name, company, source, created_by) VALUES (?, ?, 'outbound', ?)"
        ).run(company.founderName, company.name, CREATED_BY);
        founderId = result.lastInsertRowid;
        console.log(`  Created founder ID: ${founderId}`);
      }

      // Create assessment record
      const assessmentId = createAssessmentRecord(founderId);
      console.log(`  Assessment ID: ${assessmentId}`);

      let context;

      if (company.copyFromAssessmentId) {
        // Gatsby: copy inputs from existing assessment
        console.log(`  Copying inputs from assessment #${company.copyFromAssessmentId}...`);
        const count = copyInputsFromAssessment(assessmentId, company.copyFromAssessmentId);
        console.log(`  Copied ${count} inputs`);

        // Build context from copied inputs
        const allInputs = db.prepare('SELECT * FROM assessment_inputs WHERE assessment_id = ? ORDER BY input_type, id').all(assessmentId);
        context = '';
        for (const inp of allInputs) {
          const typeLabel = inp.input_type === 'deck' ? 'PITCH DECK' :
                           inp.input_type === 'transcript' ? 'CALL TRANSCRIPT' :
                           inp.input_type === 'url' ? 'WEBSITE' : 'ANALYST NOTES';
          context += `\n\n--- ${typeLabel}: ${inp.label || ''} ---\n${inp.content}`;
        }

        // Also pull founder data
        const founder = getFounderData(founderId);
        context = buildFounderContext(founder) + context;
        if (context.length > 150000) context = context.slice(0, 150000);
      } else {
        // Read filesystem files
        const fileContents = [];
        for (const f of company.files) {
          const content = readFileIfExists(f.path);
          if (content) {
            fileContents.push({ label: f.label, content, type: f.type });
          }
        }

        // Get CRM notes
        const notes = company.useCrmNotes ? getFounderNotes(founderId) : [];
        if (notes.length > 0) console.log(`  Found ${notes.length} CRM notes`);

        // Save inputs to DB
        saveInputs(assessmentId, fileContents, notes);

        // Build context
        const founder = getFounderData(founderId);
        context = buildContext(buildFounderContext(founder), fileContents, notes);
      }

      console.log(`  Context length: ${context.length} chars`);

      // Run the full assessment
      const result = await runFullAssessment(assessmentId, context);
      results.push({ company: company.name, assessmentId, score: result.synthesis.overall_score, signal: result.synthesis.overall_signal, success: true });

      // Wait between companies to avoid rate limits
      if (i < companies.length - 1) {
        console.log('  Waiting 2s before next company...');
        await sleep(2000);
      }

    } catch (err) {
      console.error(`  ERROR processing ${company.name}:`, err.message);
      results.push({ company: company.name, success: false, error: err.message });
    }
  }

  // Summary
  console.log('\n\n=== RESULTS ===');
  console.log('─'.repeat(60));
  for (const r of results) {
    if (r.success) {
      console.log(`  ${r.company.padEnd(20)} Assessment #${r.assessmentId}  ${r.score} (${r.signal})`);
    } else {
      console.log(`  ${r.company.padEnd(20)} FAILED: ${r.error}`);
    }
  }
  console.log('─'.repeat(60));
  console.log(`Done. ${results.filter(r => r.success).length}/${results.length} succeeded.`);
}

main().catch(err => {
  console.error('Fatal error:', err);
  process.exit(1);
});
