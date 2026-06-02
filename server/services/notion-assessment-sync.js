/**
 * Stu Assessment → Notion Assessments DB sync
 *
 * Pushes a complete Stu opportunity assessment into Danny's Strider Notion
 * Assessments database with the founder relation set, all 4-5 agent outputs
 * formatted as toggle blocks, and synthesis as the primary read.
 *
 * Idempotent by `Stu Assessment ID`. Re-pushing the same assessment updates
 * properties only — body content is not regenerated (delete the Notion page
 * and re-push if you want a fresh body).
 *
 * Manual trigger only — fires when Danny clicks "Send to Notion" in the
 * Stu UI (POST /api/assessments/:id/push-to-notion).
 */

const https = require('https');
const db = require('../db');

const NOTION_TOKEN = process.env.NOTION_API_KEY || process.env.NOTION_TOKEN;
const NOTION_FOUNDERS_DB_ID = process.env.NOTION_FOUNDERS_DB_ID;
const NOTION_ASSESSMENTS_DB_ID = process.env.NOTION_ASSESSMENTS_DB_ID;
const STU_BASE_URL = process.env.STU_BASE_URL || 'https://stu.vc';
const NOTION_VERSION = '2022-06-28';

const MAX_TEXT_LEN = 1900; // Notion rich_text max per block is 2000

function notion(method, path, body) {
  return new Promise((resolve, reject) => {
    const data = body ? JSON.stringify(body) : null;
    const opts = {
      hostname: 'api.notion.com', path, method,
      headers: {
        'Authorization': `Bearer ${NOTION_TOKEN}`,
        'Notion-Version': NOTION_VERSION,
        'Content-Type': 'application/json',
      },
    };
    if (data) opts.headers['Content-Length'] = Buffer.byteLength(data);
    const req = https.request(opts, (res) => {
      let chunks = '';
      res.on('data', c => chunks += c);
      res.on('end', () => {
        if (res.statusCode >= 200 && res.statusCode < 300) {
          try { resolve(chunks ? JSON.parse(chunks) : {}); }
          catch (e) { reject(new Error(`Notion parse error: ${e.message}`)); }
        } else {
          reject(new Error(`Notion ${res.statusCode}: ${chunks}`));
        }
      });
    });
    req.on('error', reject);
    if (data) req.write(data);
    req.end();
  });
}

function findFounderPageByStuId(stuFounderId) {
  return notion('POST', `/v1/databases/${NOTION_FOUNDERS_DB_ID}/query`, {
    filter: { property: 'SS Record ID', rich_text: { equals: String(stuFounderId) } },
    page_size: 1,
  }).then(res => res.results && res.results[0] || null);
}

function findAssessmentByStuId(stuAssessmentId) {
  return notion('POST', `/v1/databases/${NOTION_ASSESSMENTS_DB_ID}/query`, {
    filter: { property: 'Stu Assessment ID', rich_text: { equals: String(stuAssessmentId) } },
    page_size: 1,
  }).then(res => res.results && res.results[0] || null);
}

function rt(text) {
  return [{ type: 'text', text: { content: String(text || '').slice(0, MAX_TEXT_LEN) } }];
}

function paragraph(text) {
  return { object: 'block', type: 'paragraph', paragraph: { rich_text: rt(text) } };
}

function heading2(text) {
  return { object: 'block', type: 'heading_2', heading_2: { rich_text: rt(text) } };
}

function heading3(text) {
  return { object: 'block', type: 'heading_3', heading_3: { rich_text: rt(text) } };
}

function divider() {
  return { object: 'block', type: 'divider', divider: {} };
}

function callout(text, emoji = '📋', color = 'gray_background') {
  return {
    object: 'block', type: 'callout',
    callout: { rich_text: rt(text), icon: { type: 'emoji', emoji }, color }
  };
}

function toggle(title, childBlocks) {
  return {
    object: 'block', type: 'toggle',
    toggle: { rich_text: rt(title), children: (childBlocks || []).slice(0, 100) }
  };
}

/**
 * Convert markdown-ish text into a list of paragraph + heading blocks.
 * Splits on double newlines for paragraphs, recognizes # / ## prefixes,
 * truncates each block to fit Notion's per-block rich_text cap.
 */
function textToBlocks(text) {
  if (!text) return [paragraph('(empty)')];
  const out = [];
  const sections = String(text).split(/\n{2,}/).map(s => s.trim()).filter(Boolean);
  for (const sec of sections) {
    if (sec.startsWith('### ')) out.push(heading3(sec.slice(4)));
    else if (sec.startsWith('## ')) out.push(heading2(sec.slice(3)));
    else if (sec.startsWith('# ')) out.push(heading2(sec.slice(2)));
    else {
      // Long paragraph: split into multiple blocks at MAX_TEXT_LEN boundary on whitespace
      let remaining = sec;
      while (remaining.length > 0) {
        if (remaining.length <= MAX_TEXT_LEN) {
          out.push(paragraph(remaining));
          break;
        }
        const breakAt = remaining.lastIndexOf(' ', MAX_TEXT_LEN);
        const chunk = breakAt > 0 ? remaining.slice(0, breakAt) : remaining.slice(0, MAX_TEXT_LEN);
        out.push(paragraph(chunk));
        remaining = remaining.slice(chunk.length).trim();
      }
    }
  }
  return out.length ? out : [paragraph('(empty)')];
}

function safeParseJson(s) {
  if (!s) return null;
  try { return JSON.parse(s); } catch { return null; }
}

function formatSynthesis(synthesisRaw) {
  // synthesis_output may be a JSON object or plain text
  const obj = safeParseJson(synthesisRaw);
  if (obj && typeof obj === 'object') {
    const blocks = [];
    if (obj.executive_summary) {
      blocks.push(callout(obj.executive_summary, '📋', 'gray_background'));
    }
    // Render any string fields as labeled sections
    for (const [key, val] of Object.entries(obj)) {
      if (key === 'executive_summary') continue;
      if (typeof val === 'string' && val.trim()) {
        blocks.push(heading3(humanizeKey(key)));
        blocks.push(...textToBlocks(val));
      } else if (Array.isArray(val) && val.length) {
        blocks.push(heading3(humanizeKey(key)));
        for (const item of val) {
          if (typeof item === 'string') {
            blocks.push({ object: 'block', type: 'bulleted_list_item', bulleted_list_item: { rich_text: rt(item) } });
          } else if (item && typeof item === 'object') {
            // Render object as JSON-ish text
            blocks.push(paragraph(JSON.stringify(item)));
          }
        }
      }
    }
    return blocks;
  }
  // Fall through: treat as plain text
  return textToBlocks(synthesisRaw);
}

function humanizeKey(k) {
  return String(k).replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase());
}

function buildAssessmentBody(assessment, founder) {
  const blocks = [];

  // Header callout: signal + version + date
  const signal = assessment.overall_signal || 'Other';
  const date = assessment.created_at ? new Date(assessment.created_at).toISOString().slice(0, 10) : '';
  blocks.push(callout(
    `${signal} · v${assessment.version_number || 1} · ${date}`,
    signalEmoji(signal),
    signalColor(signal)
  ));

  // Inputs (if any)
  const inputs = safeParseJson(assessment.inputs);
  if (inputs && (inputs.decks?.length || inputs.transcripts?.length || inputs.urls?.length || inputs.notes?.length)) {
    blocks.push(heading3('Inputs'));
    if (inputs.decks?.length) blocks.push(paragraph(`Decks: ${inputs.decks.length}`));
    if (inputs.transcripts?.length) blocks.push(paragraph(`Transcripts: ${inputs.transcripts.length}`));
    if (inputs.urls?.length) {
      for (const u of inputs.urls.slice(0, 10)) blocks.push(paragraph(`URL: ${typeof u === 'string' ? u : u.url || JSON.stringify(u)}`));
    }
    if (inputs.notes?.length) blocks.push(paragraph(`Notes attached: ${inputs.notes.length}`));
  }

  blocks.push(divider());

  // Synthesis (the meat)
  blocks.push(heading2('Synthesis'));
  blocks.push(...formatSynthesis(assessment.synthesis_output));

  blocks.push(divider());

  // Agent outputs as toggles
  blocks.push(heading2('Agent Outputs'));
  const agents = [
    { key: 'founder_agent_output', label: '🧭 Founder Agent' },
    { key: 'market_agent_output', label: '📊 Market Agent' },
    { key: 'economics_agent_output', label: '💰 Economics Agent' },
    { key: 'pattern_agent_output', label: '🔁 Pattern Agent' },
    { key: 'bear_agent_output', label: '🐻 Bear Agent' },
  ];
  for (const a of agents) {
    if (assessment[a.key]) {
      blocks.push(toggle(a.label, textToBlocks(assessment[a.key])));
    }
  }

  blocks.push(divider());

  // Footer with Stu link
  const stuUrl = `${STU_BASE_URL}/founders/${assessment.founder_id}?assessment=${assessment.id}`;
  blocks.push(paragraph(`Synced from Stu.vc on ${new Date().toISOString().slice(0, 10)} · Stu assessment id: ${assessment.id}`));

  // Notion limits children to 100 per request — clip if needed
  return blocks.slice(0, 100);
}

function signalEmoji(signal) {
  const m = { 'Invest': '✅', 'Monitor': '👀', 'Pass': '🚫', 'Watch': '🔍' };
  return m[signal] || '📝';
}

function signalColor(signal) {
  const m = { 'Invest': 'green_background', 'Monitor': 'yellow_background', 'Pass': 'red_background', 'Watch': 'blue_background' };
  return m[signal] || 'gray_background';
}

async function pushAssessmentToNotion(assessmentId) {
  if (!NOTION_TOKEN || !NOTION_ASSESSMENTS_DB_ID || !NOTION_FOUNDERS_DB_ID) {
    throw new Error('NOTION_API_KEY, NOTION_FOUNDERS_DB_ID, NOTION_ASSESSMENTS_DB_ID must all be set');
  }

  const assessment = db.prepare(`
    SELECT a.*, f.name as founder_name, f.company as founder_company
    FROM opportunity_assessments a
    LEFT JOIN founders f ON a.founder_id = f.id
    WHERE a.id = ? AND a.is_deleted = 0
  `).get(assessmentId);

  if (!assessment) throw new Error(`Assessment ${assessmentId} not found`);
  if (!assessment.synthesis_output) throw new Error(`Assessment ${assessmentId} has no synthesis_output (status: ${assessment.status})`);
  if (!assessment.founder_id) throw new Error(`Assessment ${assessmentId} has no founder_id`);

  // Find the founder's Notion page so we can set the relation
  const founderPage = await findFounderPageByStuId(assessment.founder_id);
  if (!founderPage) {
    throw new Error(`Founder ${assessment.founder_id} (${assessment.founder_name}) not yet synced to Notion. Add them to investment pipeline first or run founder sync.`);
  }

  const stuUrl = `${STU_BASE_URL}/founders/${assessment.founder_id}?assessment=${assessment.id}`;
  const title = `${assessment.founder_name || 'Unknown'} — v${assessment.version_number || 1} · ${assessment.overall_signal || '?'}`;

  // Map signal to allowed Notion select option
  const allowedSignals = ['Invest', 'Monitor', 'Pass', 'Watch'];
  const signalProp = allowedSignals.includes(assessment.overall_signal) ? assessment.overall_signal : 'Other';

  const props = {
    'Title': { title: rt(title) },
    'Founder': { relation: [{ id: founderPage.id }] },
    'Overall Signal': { select: { name: signalProp } },
    'Version': { number: assessment.version_number || 1 },
    'Date Synced': { date: { start: new Date().toISOString().slice(0, 10) } },
    'Stu Assessment ID': { rich_text: rt(String(assessment.id)) },
    'Stu URL': { url: stuUrl },
  };

  const existing = await findAssessmentByStuId(assessment.id);
  if (existing) {
    // Update properties only — leave existing body alone
    const result = await notion('PATCH', `/v1/pages/${existing.id}`, { properties: props });
    console.log(`[AssessmentSync] ✓ updated Notion assessment ${existing.id} for ${assessment.founder_name}`);
    return { id: existing.id, url: existing.url, action: 'updated' };
  }

  const blocks = buildAssessmentBody(assessment, { name: assessment.founder_name, company: assessment.founder_company });

  const result = await notion('POST', '/v1/pages', {
    parent: { database_id: NOTION_ASSESSMENTS_DB_ID },
    properties: props,
    children: blocks,
  });
  console.log(`[AssessmentSync] ✓ created Notion assessment ${result.id} for ${assessment.founder_name}`);
  return { id: result.id, url: result.url, action: 'created' };
}

module.exports = { pushAssessmentToNotion, findAssessmentByStuId };
