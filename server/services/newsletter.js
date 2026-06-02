/**
 * Newsletter / Daily Brief ingestion.
 * ===================================
 * Reads a Gmail label over IMAP (using a Gmail App Password), extracts the key
 * points from each newsletter issue with Claude, ranks each by relevance to the
 * user's pipeline + thesis, and stores them for the daily Brief view.
 *
 * Credentials live in user_settings (entered by the user in Settings), never in code:
 *   newsletter_gmail_address, newsletter_gmail_app_password, newsletter_label
 */

const db = require('../db');

// ── Settings ──
function readSetting(userId, key) {
  const row = db.prepare('SELECT setting_value FROM user_settings WHERE user_id = ? AND setting_key = ?').get(userId, key);
  if (!row || row.setting_value == null) return null;
  const v = row.setting_value;
  // Strings are stored raw; objects as JSON. Return a trimmed string.
  try { const p = JSON.parse(v); return typeof p === 'string' ? p.trim() : (p ?? null); }
  catch { return String(v).trim(); }
}

function loadNewsletterConfig(userId) {
  return {
    address: readSetting(userId, 'newsletter_gmail_address'),
    // App passwords display with spaces but authenticate without them.
    appPassword: (readSetting(userId, 'newsletter_gmail_app_password') || '').replace(/\s+/g, ''),
    label: readSetting(userId, 'newsletter_label') || 'Stu/News',
  };
}

function getAnthropic(userId) {
  try {
    const keyRow = readSetting(userId, 'api_key_anthropic');
    const apiKey = keyRow || (userId === 1 ? process.env.ANTHROPIC_API_KEY : null);
    if (!apiKey) return null;
    const Anthropic = require('@anthropic-ai/sdk');
    return new Anthropic({ apiKey });
  } catch { return null; }
}

// ── Relevance ranking ──
// Default thesis keywords; supplemented by the user's configured sourcing domains.
const THESIS_KEYWORDS = [
  'chicago', 'illinois', 'midwest', 'pre-seed', 'seed round', 'ai agent', 'agentic',
  'professional services', 'construction', 'healthcare', 'legal tech', 'fintech',
  'vertical saas', 'defense', 'developer tools', 'b2b saas',
];
const DEFAULT_PRIORITY_SOURCES = ['stratechery', 'not boring', 'scott galloway', 'prof g', 'no mercy', 'upstart'];

function buildRelevanceContext(userId) {
  const founders = db.prepare(
    'SELECT name, company FROM founders WHERE created_by = ? AND is_deleted = 0'
  ).all(userId);
  const entities = [];
  for (const f of founders) {
    if (f.name && f.name.length >= 4) entities.push(f.name);
    if (f.company && f.company.length >= 3) entities.push(f.company);
  }
  let domains = [];
  try { domains = JSON.parse(readSetting(userId, 'sourcing_domains') || '[]'); } catch {}
  const keywords = [...new Set([...THESIS_KEYWORDS, ...domains.map(d => String(d).toLowerCase())])];
  let priority = DEFAULT_PRIORITY_SOURCES;
  try {
    const p = JSON.parse(readSetting(userId, 'newsletter_priority_sources') || 'null');
    if (Array.isArray(p) && p.length) priority = p.map(s => String(s).toLowerCase());
  } catch {}
  return { entities, keywords, priority };
}

function scoreRelevance(item, ctx) {
  const hay = [item.source_name, item.subject, item.summary, ...(item.key_points || [])]
    .join(' ').toLowerCase();

  const matched = [];
  for (const e of ctx.entities) {
    if (hay.includes(e.toLowerCase())) matched.push(e);
  }
  const keywordHits = ctx.keywords.filter(k => hay.includes(k));
  const sourceLc = (item.source_name || '').toLowerCase();
  const isPriority = ctx.priority.some(p => sourceLc.includes(p) || (item.sender || '').toLowerCase().includes(p));

  let score = 0;
  let category = 'general';
  let reason = '';

  if (matched.length) {
    category = 'book';
    score = 65 + Math.min(matched.length * 8, 30);
    reason = `Mentions ${[...new Set(matched)].slice(0, 3).join(', ')} from your pipeline.`;
  } else if (keywordHits.length) {
    category = 'thesis';
    score = 45 + Math.min(keywordHits.length * 5, 20);
    reason = `On your thesis: ${[...new Set(keywordHits)].slice(0, 3).join(', ')}.`;
  } else {
    category = 'general';
    score = 25;
    reason = 'General industry read.';
  }
  if (isPriority) { score += 15; reason += ' Priority source.'; }
  score = Math.max(0, Math.min(100, score));
  return { score, category, reason, matched: [...new Set(matched)] };
}

// ── Claude extraction ──
const EXTRACT_SYSTEM = `You distill a newsletter issue into the few things that matter, fast.
Return ONLY valid JSON:
{
  "source_name": "<the newsletter's name, e.g. 'Stratechery', 'Not Boring' — infer from sender/branding>",
  "summary": "<one sentence: the single most important takeaway from this issue>",
  "key_points": ["<2-4 crisp bullets capturing the core insights — specific, not generic>"],
  "url": "<the best single 'read the full issue' link, or the most important article link; empty string if none>"
}
Rules: be specific and concrete. No hype, no filler. If the email is mostly ads/housekeeping, return at most one key point and an empty-ish summary.`;

function firstUrl(text) {
  const m = String(text || '').match(/https?:\/\/[^\s)>\]]+/);
  return m ? m[0] : '';
}

async function extractIssue(client, mail) {
  const text = (mail.text || mail.html || '').toString();
  const fallback = {
    source_name: (mail.fromName || mail.from || 'Newsletter'),
    summary: mail.subject || '',
    key_points: [],
    url: firstUrl(text),
  };
  if (!client) return fallback;
  try {
    const resp = await client.messages.create({
      model: 'claude-sonnet-4-20250514',
      max_tokens: 700,
      system: EXTRACT_SYSTEM,
      messages: [{
        role: 'user',
        content: `Newsletter sender: ${mail.from || 'unknown'}\nSubject: ${mail.subject || ''}\n\nBody (plain text):\n${text.slice(0, 8000)}`,
      }],
    });
    const raw = resp.content[0].text.trim();
    const json = raw.match(/\{[\s\S]*\}/);
    if (!json) return fallback;
    const parsed = JSON.parse(json[0]);
    return {
      source_name: parsed.source_name || fallback.source_name,
      summary: parsed.summary || fallback.summary,
      key_points: Array.isArray(parsed.key_points) ? parsed.key_points.slice(0, 5) : [],
      url: parsed.url || fallback.url,
    };
  } catch {
    return fallback;
  }
}

// ── Main ingestion ──
async function fetchAndProcess(userId, { limit = 30 } = {}) {
  const cfg = loadNewsletterConfig(userId);
  if (!cfg.address || !cfg.appPassword) {
    return { ok: false, error: 'Gmail address and App Password not configured in Settings.' };
  }

  let ImapFlow, simpleParser;
  try {
    ({ ImapFlow } = require('imapflow'));
    ({ simpleParser } = require('mailparser'));
  } catch (e) {
    return { ok: false, error: 'Email libraries not available on server: ' + e.message };
  }

  const client = new ImapFlow({
    host: 'imap.gmail.com',
    port: 993,
    secure: true,
    auth: { user: cfg.address, pass: cfg.appPassword },
    logger: false,
  });

  const anthropic = getAnthropic(userId);
  const ctx = buildRelevanceContext(userId);
  const todayRow = db.prepare("SELECT date('now','localtime') AS d").get();
  const briefDate = todayRow.d;

  let fetched = 0, added = 0;
  const errors = [];

  try {
    await client.connect();
  } catch (e) {
    return { ok: false, error: `Could not connect to Gmail (check address/App Password): ${e.message}` };
  }

  let lock;
  try {
    lock = await client.getMailboxLock(cfg.label);
  } catch (e) {
    try { await client.logout(); } catch {}
    return { ok: false, error: `Could not open label "${cfg.label}" (create it in Gmail and tag a newsletter first): ${e.message}` };
  }

  const insert = db.prepare(`
    INSERT INTO newsletter_items
      (user_id, message_id, source_name, sender, subject, received_at, brief_date, url, summary, key_points, relevance_score, relevance_reason, matched_entities, category)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);

  try {
    // Unseen messages in the label; cap to `limit` (process newest).
    let uids = [];
    try { uids = await client.search({ seen: false }, { uid: true }); } catch { uids = []; }
    if (!Array.isArray(uids)) uids = [];
    const targetUids = uids.slice(-limit);

    for (const uid of targetUids) {
      try {
        const msg = await client.fetchOne(uid, { source: true, envelope: true }, { uid: true });
        if (!msg || !msg.source) continue;
        fetched++;
        const mail = await simpleParser(msg.source);
        const messageId = mail.messageId || (msg.envelope && msg.envelope.messageId) || `uid:${uid}:${cfg.label}`;

        // Dedupe
        const exists = db.prepare('SELECT id FROM newsletter_items WHERE user_id = ? AND message_id = ?').get(userId, messageId);
        if (exists) { await client.messageFlagsAdd(uid, ['\\Seen'], { uid: true }).catch(() => {}); continue; }

        const fromName = mail.from?.value?.[0]?.name || '';
        const fromAddr = mail.from?.text || '';
        const item = await extractIssue(anthropic, {
          text: mail.text, html: mail.html, subject: mail.subject, from: fromAddr, fromName,
        });
        item.subject = mail.subject || '';
        item.sender = fromAddr;
        const rel = scoreRelevance(item, ctx);

        insert.run(
          userId, messageId, item.source_name, fromAddr, mail.subject || '',
          mail.date ? new Date(mail.date).toISOString() : null,
          briefDate, item.url || '', item.summary || '',
          JSON.stringify(item.key_points || []),
          rel.score, rel.reason, JSON.stringify(rel.matched), rel.category
        );
        added++;
        await client.messageFlagsAdd(uid, ['\\Seen'], { uid: true }).catch(() => {});
      } catch (e) {
        errors.push(`uid ${uid}: ${e.message}`);
      }
    }
  } finally {
    if (lock) lock.release();
    try { await client.logout(); } catch {}
  }

  return { ok: true, fetched, added, errors, briefDate };
}

module.exports = { fetchAndProcess, loadNewsletterConfig, scoreRelevance, buildRelevanceContext };
