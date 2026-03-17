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

// ── Tool definitions for Claude ──
const TOOLS = [
  {
    name: 'search_founders',
    description: 'Search the founder pipeline by name, company, status, domain, stage, track, or any combination. Returns matching founders with their key details.',
    input_schema: {
      type: 'object',
      properties: {
        search: { type: 'string', description: 'Free text search across name, company, domain, bio, one-liner' },
        status: { type: 'string', description: 'Relationship status: Identified, Contacted, Meeting Scheduled, Met, Passed' },
        track: { type: 'string', description: 'Pipeline track filter: "resident" or "investment"' },
        deal_status: { type: 'string', description: 'Investment deal status: Under Consideration, Active Diligence, IC Review, Committed, Passed' },
        resident_status: { type: 'string', description: 'Resident status: Prospect, Tour Scheduled, Admitted, Active, Alumni' },
        domain: { type: 'string', description: 'Filter by domain/sector' },
        stage: { type: 'string', description: 'Filter by stage: Pre-seed, Seed, Series A' },
        limit: { type: 'number', description: 'Max results to return (default 20)' }
      }
    }
  },
  {
    name: 'get_founder_detail',
    description: 'Get full details for a specific founder including notes, calls, assessments, track info, and deal data.',
    input_schema: {
      type: 'object',
      properties: {
        founder_id: { type: 'number', description: 'The founder ID' },
        name: { type: 'string', description: 'Search by name if ID is not known' }
      }
    }
  },
  {
    name: 'create_founder',
    description: 'Add a new founder to the pipeline. Can optionally set pipeline tracks (resident, investment, or both).',
    input_schema: {
      type: 'object',
      properties: {
        name: { type: 'string', description: 'Full name (required)' },
        company: { type: 'string', description: 'Company name' },
        role: { type: 'string', description: 'Role/title' },
        email: { type: 'string', description: 'Email address' },
        linkedin_url: { type: 'string', description: 'LinkedIn profile URL' },
        location_city: { type: 'string', description: 'City' },
        location_state: { type: 'string', description: 'State' },
        stage: { type: 'string', description: 'Pre-seed, Seed, or Series A' },
        domain: { type: 'string', description: 'Sector/domain' },
        source: { type: 'string', description: 'How this founder was sourced' },
        bio: { type: 'string', description: 'Brief bio or background' },
        chicago_connection: { type: 'string', description: 'Connection to Chicago' },
        previous_companies: { type: 'string', description: 'Previous companies' },
        notable_background: { type: 'string', description: 'Notable background info' },
        company_one_liner: { type: 'string', description: 'Company description one-liner' },
        pipeline_tracks: { type: 'string', description: 'Comma-separated tracks: "resident", "investment", or "resident,investment"' },
        resident_status: { type: 'string', description: 'Resident status if on resident track' },
        deal_status: { type: 'string', description: 'Deal status if on investment track' }
      },
      required: ['name']
    }
  },
  {
    name: 'update_founder',
    description: 'Update a founder\'s information — change status, tracks, deal data, or any field.',
    input_schema: {
      type: 'object',
      properties: {
        founder_id: { type: 'number', description: 'Founder ID (required if name not given)' },
        name_search: { type: 'string', description: 'Find founder by name if ID unknown' },
        updates: {
          type: 'object',
          description: 'Fields to update',
          properties: {
            name: { type: 'string' }, company: { type: 'string' }, role: { type: 'string' },
            email: { type: 'string' }, linkedin_url: { type: 'string' },
            location_city: { type: 'string' }, location_state: { type: 'string' },
            stage: { type: 'string' }, domain: { type: 'string' }, status: { type: 'string' },
            source: { type: 'string' }, bio: { type: 'string' },
            chicago_connection: { type: 'string' }, previous_companies: { type: 'string' },
            notable_background: { type: 'string' }, company_one_liner: { type: 'string' },
            next_action: { type: 'string' },
            pipeline_tracks: { type: 'string' },
            resident_status: { type: 'string' }, desks_needed: { type: 'number' },
            deal_status: { type: 'string' }, deal_lead: { type: 'string' },
            valuation: { type: 'number' }, round_size: { type: 'number' },
            investment_amount: { type: 'number' }, arr: { type: 'number' },
            monthly_burn: { type: 'number' }, runway_months: { type: 'number' },
            security_type: { type: 'string' }, memo_status: { type: 'string' },
            diligence_status: { type: 'string' }, pass_reason: { type: 'string' }
          }
        }
      },
      required: ['updates']
    }
  },
  {
    name: 'delete_founder',
    description: 'Soft-delete a founder from the pipeline.',
    input_schema: {
      type: 'object',
      properties: {
        founder_id: { type: 'number', description: 'Founder ID' },
        name_search: { type: 'string', description: 'Find founder by name if ID unknown' }
      }
    }
  },
  {
    name: 'add_note',
    description: 'Add a note to a founder\'s profile.',
    input_schema: {
      type: 'object',
      properties: {
        founder_id: { type: 'number', description: 'Founder ID' },
        name_search: { type: 'string', description: 'Find founder by name if ID unknown' },
        content: { type: 'string', description: 'The note content' }
      },
      required: ['content']
    }
  },
  {
    name: 'get_pipeline_stats',
    description: 'Get pipeline statistics — total founders, counts by status, by track, by deal status, by domain, etc.',
    input_schema: { type: 'object', properties: {} }
  },
  {
    name: 'get_assessments',
    description: 'List opportunity assessments.',
    input_schema: {
      type: 'object',
      properties: {
        founder_id: { type: 'number', description: 'Filter by founder' },
        signal: { type: 'string', description: 'Filter by signal: Strong Pass, Pass, Watch, Pass On' }
      }
    }
  },
  {
    name: 'run_fit_score',
    description: 'Run an AI fit score analysis on a founder.',
    input_schema: {
      type: 'object',
      properties: {
        founder_id: { type: 'number', description: 'Founder ID' },
        name_search: { type: 'string', description: 'Find founder by name if ID unknown' }
      }
    }
  },
  {
    name: 'log_call',
    description: 'Log a call transcript for a founder.',
    input_schema: {
      type: 'object',
      properties: {
        founder_id: { type: 'number', description: 'Founder ID' },
        name_search: { type: 'string', description: 'Find founder by name if ID unknown' },
        transcript: { type: 'string', description: 'The call transcript text' }
      },
      required: ['transcript']
    }
  },
  {
    name: 'query_insights',
    description: 'Run custom analytical queries across the platform data. Use for questions like "what percentage of our pipeline is AI", "average fit score", "show me all residents who are also in the investment pipeline", "how many deals are in diligence", etc.',
    input_schema: {
      type: 'object',
      properties: {
        question: { type: 'string', description: 'The analytical question to answer' }
      },
      required: ['question']
    }
  }
];

// ── Tool execution ──
function resolveFounder(params) {
  if (params.founder_id) {
    return db.prepare('SELECT * FROM founders WHERE id = ? AND is_deleted = 0').get(params.founder_id);
  }
  if (params.name_search || params.name) {
    const search = params.name_search || params.name;
    return db.prepare("SELECT * FROM founders WHERE is_deleted = 0 AND name LIKE ? ORDER BY updated_at DESC LIMIT 1").get(`%${search}%`);
  }
  return null;
}

function executeTool(toolName, input, userId) {
  switch (toolName) {
    case 'search_founders': {
      let sql = `SELECT id, name, company, role, domain, stage, status, fit_score, location_city, location_state, source, pipeline_tracks, deal_status, resident_status, company_one_liner, deal_lead, valuation, round_size, created_at, updated_at FROM founders WHERE is_deleted = 0`;
      const params = [];
      if (input.search) {
        sql += " AND (name LIKE ? OR company LIKE ? OR domain LIKE ? OR bio LIKE ? OR company_one_liner LIKE ?)";
        const s = `%${input.search}%`;
        params.push(s, s, s, s, s);
      }
      if (input.status) { sql += ' AND status = ?'; params.push(input.status); }
      if (input.domain) { sql += ' AND domain LIKE ?'; params.push(`%${input.domain}%`); }
      if (input.stage) { sql += ' AND stage = ?'; params.push(input.stage); }
      if (input.track === 'resident') { sql += " AND pipeline_tracks LIKE '%resident%'"; }
      if (input.track === 'investment') { sql += " AND pipeline_tracks LIKE '%investment%'"; }
      if (input.deal_status) { sql += ' AND deal_status = ?'; params.push(input.deal_status); }
      if (input.resident_status) { sql += ' AND resident_status = ?'; params.push(input.resident_status); }
      sql += ' ORDER BY updated_at DESC LIMIT ?';
      params.push(input.limit || 20);
      const founders = db.prepare(sql).all(...params);
      return { success: true, count: founders.length, founders };
    }

    case 'get_founder_detail': {
      const founder = resolveFounder(input);
      if (!founder) return { success: false, error: 'Founder not found' };
      const notes = db.prepare('SELECT id, content, created_at FROM founder_notes WHERE founder_id = ? ORDER BY created_at DESC LIMIT 10').all(founder.id);
      const calls = db.prepare('SELECT id, structured_summary, created_at FROM call_logs WHERE founder_id = ? ORDER BY created_at DESC LIMIT 5').all(founder.id);
      const assessments = db.prepare('SELECT id, overall_signal, status, created_at FROM opportunity_assessments WHERE founder_id = ? ORDER BY created_at DESC').all(founder.id);
      return { success: true, founder, notes, calls, assessments };
    }

    case 'create_founder': {
      const fields = ['name', 'company', 'role', 'email', 'linkedin_url', 'location_city', 'location_state', 'stage', 'domain', 'source', 'bio', 'chicago_connection', 'previous_companies', 'notable_background', 'company_one_liner', 'pipeline_tracks', 'resident_status', 'deal_status'];
      const cols = ['created_by'];
      const vals = [userId];
      for (const f of fields) {
        if (input[f]) { cols.push(f); vals.push(input[f]); }
      }
      // Auto-set deal_entered_at if investment track
      if (input.pipeline_tracks?.includes('investment')) {
        cols.push('deal_entered_at');
        vals.push(new Date().toISOString());
      }
      const placeholders = cols.map(() => '?').join(', ');
      const result = db.prepare(`INSERT INTO founders (${cols.join(', ')}) VALUES (${placeholders})`).run(...vals);
      const founder = db.prepare('SELECT * FROM founders WHERE id = ?').get(result.lastInsertRowid);
      const trackInfo = [];
      if (founder.pipeline_tracks?.includes('resident')) trackInfo.push('Resident');
      if (founder.pipeline_tracks?.includes('investment')) trackInfo.push('Investment');
      return { success: true, message: `Added ${founder.name} to pipeline${trackInfo.length ? ` (${trackInfo.join(' + ')})` : ''}`, founder };
    }

    case 'update_founder': {
      const founder = resolveFounder(input);
      if (!founder) return { success: false, error: 'Founder not found' };
      const allowed = ['name', 'company', 'role', 'email', 'linkedin_url', 'location_city', 'location_state', 'stage', 'domain', 'status', 'source', 'bio', 'chicago_connection', 'previous_companies', 'notable_background', 'company_one_liner', 'next_action', 'pipeline_tracks', 'resident_status', 'deal_status', 'deal_lead', 'valuation', 'round_size', 'investment_amount', 'arr', 'monthly_burn', 'runway_months', 'security_type', 'memo_status', 'diligence_status', 'pass_reason', 'desks_needed'];
      const sets = [];
      const vals = [];
      for (const [k, v] of Object.entries(input.updates || {})) {
        if (allowed.includes(k) && v !== undefined) {
          sets.push(`${k} = ?`);
          vals.push(v);
        }
      }
      if (sets.length === 0) return { success: false, error: 'No valid fields to update' };
      // Auto-set deal_entered_at
      if (input.updates.deal_status && !founder.deal_entered_at) {
        sets.push('deal_entered_at = CURRENT_TIMESTAMP');
      }
      if (input.updates.resident_status === 'Admitted' && !founder.admitted_at) {
        sets.push('admitted_at = CURRENT_TIMESTAMP');
      }
      sets.push('updated_at = CURRENT_TIMESTAMP');
      vals.push(founder.id);
      db.prepare(`UPDATE founders SET ${sets.join(', ')} WHERE id = ?`).run(...vals);
      const updated = db.prepare('SELECT * FROM founders WHERE id = ?').get(founder.id);
      return { success: true, message: `Updated ${updated.name}`, founder: updated, changed: Object.keys(input.updates) };
    }

    case 'delete_founder': {
      const founder = resolveFounder(input);
      if (!founder) return { success: false, error: 'Founder not found' };
      db.prepare('UPDATE founders SET is_deleted = 1, updated_at = CURRENT_TIMESTAMP WHERE id = ?').run(founder.id);
      return { success: true, message: `Removed ${founder.name} from pipeline` };
    }

    case 'add_note': {
      const founder = resolveFounder(input);
      if (!founder) return { success: false, error: 'Founder not found' };
      const result = db.prepare('INSERT INTO founder_notes (founder_id, content, created_by) VALUES (?, ?, ?)').run(founder.id, input.content, userId);
      return { success: true, message: `Note added to ${founder.name}'s profile`, note_id: result.lastInsertRowid, founder_name: founder.name };
    }

    case 'get_pipeline_stats': {
      const total = db.prepare('SELECT COUNT(*) as count FROM founders WHERE is_deleted = 0').get().count;
      const byStatus = db.prepare('SELECT status, COUNT(*) as count FROM founders WHERE is_deleted = 0 GROUP BY status ORDER BY count DESC').all();
      const byDomain = db.prepare(`SELECT domain, COUNT(*) as count FROM founders WHERE is_deleted = 0 AND domain IS NOT NULL AND domain != '' GROUP BY domain ORDER BY count DESC`).all();
      const byStage = db.prepare('SELECT stage, COUNT(*) as count FROM founders WHERE is_deleted = 0 GROUP BY stage ORDER BY count DESC').all();
      const residents = db.prepare("SELECT COUNT(*) as count FROM founders WHERE is_deleted = 0 AND pipeline_tracks LIKE '%resident%'").get().count;
      const investments = db.prepare("SELECT COUNT(*) as count FROM founders WHERE is_deleted = 0 AND pipeline_tracks LIKE '%investment%'").get().count;
      const byDealStatus = db.prepare("SELECT deal_status, COUNT(*) as count FROM founders WHERE is_deleted = 0 AND deal_status IS NOT NULL GROUP BY deal_status ORDER BY count DESC").all();
      const byResidentStatus = db.prepare("SELECT resident_status, COUNT(*) as count FROM founders WHERE is_deleted = 0 AND resident_status IS NOT NULL GROUP BY resident_status ORDER BY count DESC").all();
      const recentlyAdded = db.prepare('SELECT name, company, status, pipeline_tracks, created_at FROM founders WHERE is_deleted = 0 ORDER BY created_at DESC LIMIT 5').all();
      const avgFitScore = db.prepare('SELECT AVG(fit_score) as avg, COUNT(fit_score) as scored FROM founders WHERE is_deleted = 0 AND fit_score IS NOT NULL').get();
      const assessmentCount = db.prepare('SELECT COUNT(*) as count FROM opportunity_assessments').get().count;
      return { success: true, total, byStatus, byDomain, byStage, residents, investments, byDealStatus, byResidentStatus, recentlyAdded, avgFitScore, assessmentCount };
    }

    case 'get_assessments': {
      let sql = `SELECT oa.id, oa.overall_signal, oa.status, oa.created_at,
        f.name as founder_name, f.company as founder_company
        FROM opportunity_assessments oa
        LEFT JOIN founders f ON oa.founder_id = f.id WHERE 1=1`;
      const params = [];
      if (input.founder_id) { sql += ' AND oa.founder_id = ?'; params.push(input.founder_id); }
      if (input.signal) { sql += ' AND oa.overall_signal = ?'; params.push(input.signal); }
      sql += ' ORDER BY oa.created_at DESC LIMIT 20';
      const assessments = db.prepare(sql).all(...params);
      return { success: true, count: assessments.length, assessments };
    }

    case 'run_fit_score': {
      const founder = resolveFounder(input);
      if (!founder) return { success: false, error: 'Founder not found' };
      return { success: true, message: 'Fit score will be generated', founder_id: founder.id, founder_name: founder.name, needs_ai_scoring: true };
    }

    case 'log_call': {
      const founder = resolveFounder(input);
      if (!founder) return { success: false, error: 'Founder not found. Please specify which founder this call was with.' };
      const result = db.prepare('INSERT INTO call_logs (founder_id, raw_transcript, created_by) VALUES (?, ?, ?)').run(founder.id, input.transcript, userId);
      return { success: true, message: `Call transcript logged for ${founder.name}`, call_id: result.lastInsertRowid, founder_name: founder.name };
    }

    case 'query_insights': {
      const total = db.prepare('SELECT COUNT(*) as count FROM founders WHERE is_deleted = 0').get().count;
      const byStatus = db.prepare('SELECT status, COUNT(*) as count FROM founders WHERE is_deleted = 0 GROUP BY status').all();
      const byDomain = db.prepare(`SELECT domain, COUNT(*) as count FROM founders WHERE is_deleted = 0 AND domain IS NOT NULL AND domain != '' GROUP BY domain`).all();
      const residents = db.prepare("SELECT COUNT(*) as count FROM founders WHERE is_deleted = 0 AND pipeline_tracks LIKE '%resident%'").get().count;
      const investments = db.prepare("SELECT COUNT(*) as count FROM founders WHERE is_deleted = 0 AND pipeline_tracks LIKE '%investment%'").get().count;
      const byDealStatus = db.prepare("SELECT deal_status, COUNT(*) as count FROM founders WHERE is_deleted = 0 AND deal_status IS NOT NULL GROUP BY deal_status").all();
      const byResidentStatus = db.prepare("SELECT resident_status, COUNT(*) as count FROM founders WHERE is_deleted = 0 AND resident_status IS NOT NULL GROUP BY resident_status").all();
      const scored = db.prepare('SELECT name, company, domain, fit_score, status, pipeline_tracks, deal_status FROM founders WHERE is_deleted = 0 AND fit_score IS NOT NULL ORDER BY fit_score DESC').all();
      const recent = db.prepare('SELECT name, company, status, domain, stage, pipeline_tracks, deal_status, resident_status, created_at FROM founders WHERE is_deleted = 0 ORDER BY created_at DESC LIMIT 10').all();
      const passed = db.prepare("SELECT name, company, domain, pass_reason FROM founders WHERE is_deleted = 0 AND (status = 'Passed' OR deal_status = 'Passed')").all();
      const activeDeals = db.prepare("SELECT name, company, deal_status, deal_lead, valuation, round_size, arr FROM founders WHERE is_deleted = 0 AND pipeline_tracks LIKE '%investment%' AND deal_status NOT IN ('Passed', 'Committed') ORDER BY deal_entered_at DESC").all();
      const assessments = db.prepare(`SELECT oa.overall_signal, f.name, f.company FROM opportunity_assessments oa LEFT JOIN founders f ON oa.founder_id = f.id WHERE oa.status = 'complete' ORDER BY oa.created_at DESC LIMIT 10`).all();
      return {
        success: true,
        question: input.question,
        data: { total, byStatus, byDomain, residents, investments, byDealStatus, byResidentStatus, scored, recent, passed, activeDeals, assessments }
      };
    }

    default:
      return { success: false, error: `Unknown tool: ${toolName}` };
  }
}

const STU_SYSTEM = `You are Stu, the intelligence layer for Superior Studios — a Chicago-based pre-seed venture fund with a founder community/residency program.

You are the team's primary interface for managing the unified pipeline. Every founder has one record that flows through relationship stages with two activatable tracks.

PIPELINE MODEL:
- Relationship stages (status): Identified → Contacted → Meeting Scheduled → Met → Passed
- Resident Track: Prospect → Tour Scheduled → Admitted → Active → Alumni (for the coworking community)
- Investment Track: Under Consideration → Active Diligence → IC Review → Committed / Passed (for fund investments)
- A founder can be on NEITHER, ONE, or BOTH tracks simultaneously
- pipeline_tracks field is comma-separated: "resident", "investment", or "resident,investment"

BEHAVIOR:
- Be direct and concise. Never start with "Great question" or filler.
- When the user gives you information about a founder/meeting/deal, proactively use tools to record it.
- When creating founders, infer the right tracks from context (e.g., "met a founder at the space" → resident track, "interesting deal" → investment track).
- When the user says "move to diligence" or "start investment process", set pipeline_tracks to include "investment" and set deal_status appropriately.
- When presenting data, format it cleanly with lists and structure.
- For analytical questions, use query_insights then synthesize a clear answer.

INVESTMENT CONTEXT:
- Superior Studios invests pre-seed in Chicago/Midwest founders
- Focus: B2B SaaS, AI Infrastructure, Vertical Software, Fintech, Healthtech, Marketplace
- Four required founder traits: Speed, Storytelling, Salesmanship, Build+Motivate
- Team: Brandon Cruz (Managing Partner), Eric Hutt (VP), Rob Schinske (Senior Associate), Danny Goodman (Strategic Initiatives)
- Signals: Strong Pass, Pass, Watch, Pass On`;

// POST /api/stu/chat — tool-use powered chat
router.post('/chat', async (req, res) => {
  const client = getAnthropicClient();
  if (!client) return res.status(503).json({ error: 'AI unavailable — configure ANTHROPIC_API_KEY' });

  const { messages } = req.body;
  if (!messages || !messages.length) return res.status(400).json({ error: 'Messages required' });

  const userId = req.user?.id;

  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');

  try {
    let conversationMessages = messages.map(m => {
      if (m.role === 'tool_results') return { role: 'user', content: m.content };
      return { role: m.role, content: m.content };
    });

    let maxIterations = 5;

    while (maxIterations-- > 0) {
      const response = await client.messages.create({
        model: 'claude-sonnet-4-20250514',
        max_tokens: 4096,
        system: STU_SYSTEM,
        tools: TOOLS,
        messages: conversationMessages
      });

      const toolUses = response.content.filter(b => b.type === 'tool_use');
      const textBlocks = response.content.filter(b => b.type === 'text');

      for (const block of textBlocks) {
        if (block.text) {
          res.write(`data: ${JSON.stringify({ type: 'text', text: block.text })}\n\n`);
        }
      }

      if (toolUses.length === 0 || response.stop_reason === 'end_turn') {
        if (toolUses.length === 0) break;
        if (response.stop_reason === 'end_turn' && toolUses.length === 0) break;
      }

      if (toolUses.length > 0) {
        for (const tu of toolUses) {
          res.write(`data: ${JSON.stringify({ type: 'tool_call', tool: tu.name, input: tu.input })}\n\n`);
        }

        const toolResults = toolUses.map(tu => {
          const result = executeTool(tu.name, tu.input, userId);
          res.write(`data: ${JSON.stringify({ type: 'tool_result', tool: tu.name, result })}\n\n`);
          return {
            type: 'tool_result',
            tool_use_id: tu.id,
            content: JSON.stringify(result)
          };
        });

        conversationMessages.push({ role: 'assistant', content: response.content });
        conversationMessages.push({ role: 'user', content: toolResults });
        continue;
      }

      break;
    }

    res.write(`data: ${JSON.stringify({ type: 'done' })}\n\n`);
    res.end();
  } catch (err) {
    console.error('Stu chat error:', err);
    res.write(`data: ${JSON.stringify({ type: 'error', error: err.message })}\n\n`);
    res.end();
  }
});

module.exports = router;
