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
  // Sensitive settings (e.g. the Gmail app password) are encrypted at rest — decrypt
  // before use, or this returns ciphertext. decrypt() passes plaintext through unchanged.
  const v = require('../lib/secrets').decrypt(row.setting_value);
  if (v == null) return null;
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
  return require('../lib/providerKeys').anthropicFor(userId, 'newsletter');
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
      model: 'claude-sonnet-4-6',
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

  // Resolve the label to an actual IMAP mailbox path. Gmail nests labels with a
  // server-specific delimiter and is case/format sensitive, so we list the real
  // mailboxes and match flexibly rather than trusting the raw string.
  let mailboxes = [];
  try { mailboxes = await client.list(); } catch { mailboxes = []; }
  const want = cfg.label.toLowerCase().trim();
  const delim = (mailboxes.find(m => m.delimiter) || {}).delimiter || '/';
  const wantAlt = want.replace(/[\/.]/g, delim).toLowerCase();
  const lastSeg = want.split(/[\/.]/).pop();
  const norm = (s) => String(s || '').toLowerCase().replace(/[\/.]/g, '/');
  const match =
    mailboxes.find(m => norm(m.path) === norm(want)) ||
    mailboxes.find(m => (m.path || '').toLowerCase() === wantAlt) ||
    mailboxes.find(m => (m.name || '').toLowerCase() === lastSeg);
  const targetPath = match ? match.path : cfg.label;

  let lock;
  try {
    lock = await client.getMailboxLock(targetPath);
  } catch (e) {
    const visible = mailboxes
      .map(m => m.path)
      .filter(p => p && !/^\[Gmail\]/i.test(p))
      .slice(0, 40);
    try { await client.logout(); } catch {}
    return {
      ok: false,
      error: `Couldn't open the "${cfg.label}" label. Labels Stu can see: ${visible.join(', ') || '(none — enable IMAP in Gmail settings, and turn on "Show in IMAP" for the label)'}. Check the exact name/spelling in Settings.`,
    };
  }

  const insert = db.prepare(`
    INSERT INTO newsletter_items
      (user_id, message_id, source_name, sender, subject, received_at, brief_date, url, summary, key_points, relevance_score, relevance_reason, matched_entities, category)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);

  try {
    // Pull the NEWEST messages in the label regardless of read/unread — on a first
    // sync the newsletters you tagged are usually already-read. Dedupe by Message-ID
    // (below) keeps re-syncs from reprocessing the same issues.
    let uids = [];
    try { uids = await client.search({ all: true }, { uid: true }); } catch { uids = []; }
    if (!Array.isArray(uids) || uids.length === 0) {
      try { uids = await client.search({ seen: false }, { uid: true }); } catch { uids = []; }
    }
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

// ════════════════════════════════════════════════════════════════
// Managed sources: RSS feeds + email senders (no manual labeling)
// ════════════════════════════════════════════════════════════════

const RECENT_DAYS = 10;          // rolling window for the feed
const PER_SOURCE = 15;           // max items pulled per source per sync

function briefDateOf(date) {
  const d = date ? new Date(date) : new Date();
  if (isNaN(d.getTime())) return new Date().toISOString().slice(0, 10);
  return d.toISOString().slice(0, 10);
}
function isRecent(date) {
  if (!date) return true; // keep undated items (we'll stamp today)
  const d = new Date(date);
  if (isNaN(d.getTime())) return true;
  return (Date.now() - d.getTime()) <= RECENT_DAYS * 86400000;
}
function stripHtml(s) {
  return String(s || '').replace(/<[^>]+>/g, ' ').replace(/&[a-z]+;/g, ' ').replace(/\s+/g, ' ').trim();
}

const ITEM_INSERT_COLS = `(user_id, source_id, message_id, source_name, sender, subject, received_at, brief_date, url, summary, key_points, relevance_score, relevance_reason, matched_entities, category)`;
function itemInsertStmt() {
  return db.prepare(`INSERT INTO newsletter_items ${ITEM_INSERT_COLS} VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`);
}

// Dedupe + extract + rank + store one issue. Returns true if newly added.
// Cross-source dedup helpers: the same story across multiple newsletters should collapse.
function canonUrl(u) { return String(u || '').toLowerCase().split(/[?#]/)[0].replace(/\/+$/, ''); }
function normTitle(t) { return String(t || '').toLowerCase().replace(/[^a-z0-9 ]/g, '').replace(/\s+/g, ' ').trim(); }

function crossSourceDuplicate(userId, url, subject) {
  const cu = canonUrl(url);
  const nt = normTitle(subject);
  const recent = db.prepare("SELECT subject, url FROM newsletter_items WHERE user_id = ? AND is_deleted = 0 AND (brief_date >= date('now','localtime','-4 days') OR brief_date IS NULL)").all(userId);
  return recent.some(r => (cu && cu.length > 8 && canonUrl(r.url) === cu) || (nt && nt.length > 12 && normTitle(r.subject) === nt));
}

async function storeItem(userId, m, ctx, anthropic, sourceId, insert) {
  const exists = db.prepare('SELECT id FROM newsletter_items WHERE user_id = ? AND message_id = ?').get(userId, m.message_id);
  if (exists) return false;
  const item = await extractIssue(anthropic, {
    text: m.text, html: m.html, subject: m.subject, from: m.sender, fromName: m.fromName,
  });
  item.subject = m.subject || '';
  item.sender = m.sender || '';
  if (m.url && !item.url) item.url = m.url;
  if (m.sourceName) item.source_name = m.sourceName;
  // Collapse the same story arriving from multiple newsletters (shared link or near-identical title).
  if (crossSourceDuplicate(userId, item.url, m.subject)) return false;
  const rel = scoreRelevance(item, ctx);
  insert.run(
    userId, sourceId || null, m.message_id, item.source_name, m.sender || '', m.subject || '',
    m.date ? new Date(m.date).toISOString() : null, briefDateOf(m.date),
    item.url || '', item.summary || '', JSON.stringify(item.key_points || []),
    rel.score, rel.reason, JSON.stringify(rel.matched), rel.category
  );
  return true;
}

// ── RSS auto-discovery ──
// Robust: sends a real User-Agent, follows redirects, tries many common feed paths,
// and parses the homepage HTML for declared feed links (catches beehiiv, Ghost, etc.).
const FEED_UA = 'Mozilla/5.0 (compatible; StuDailyBrief/1.0; +https://stu.vc)';

async function fetchText(url) {
  try {
    const res = await fetch(url, {
      headers: { 'User-Agent': FEED_UA, 'Accept': 'application/rss+xml, application/atom+xml, application/xml, text/xml, text/html, */*' },
      redirect: 'follow',
    });
    if (!res.ok) return null;
    const contentType = res.headers.get('content-type') || '';
    const body = await res.text();
    return { body, contentType, finalUrl: res.url };
  } catch { return null; }
}

async function tryParseFeed(parser, url) {
  const r = await fetchText(url);
  if (!r) return null;
  const looksXml = /xml|rss|atom/i.test(r.contentType) || /^\s*(<\?xml|<rss|<feed)/i.test(r.body);
  if (!looksXml) return { html: r.body, finalUrl: r.finalUrl };
  try {
    const feed = await parser.parseString(r.body);
    if (feed && Array.isArray(feed.items)) return { feedUrl: url, title: feed.title || null };
  } catch { /* not a valid feed */ }
  return { html: r.body, finalUrl: r.finalUrl };
}

async function discoverFeedUrl(rawUrl) {
  let u = String(rawUrl || '').trim();
  if (!u) return null;
  if (!/^https?:\/\//i.test(u)) u = 'https://' + u;
  const base = u.replace(/\/+$/, '');
  const Parser = require('rss-parser');
  const parser = new Parser({ timeout: 12000, headers: { 'User-Agent': FEED_UA } });

  // Candidate feed paths covering Substack, WordPress, Ghost, Hugo/Jekyll, etc.
  const candidates = [u];
  let host = '';
  try { host = new URL(u).host; } catch {}
  if (/substack\.com$/i.test(host)) candidates.push(`https://${host}/feed`);
  if (!/\/feed\/?$|\.xml$|\.rss$|\/rss\/?$/i.test(u)) {
    candidates.push(`${base}/feed`, `${base}/rss`, `${base}/rss.xml`, `${base}/feed.xml`, `${base}/atom.xml`, `${base}/index.xml`);
  }

  let homepageHtml = null, homepageUrl = u;
  for (const candidate of candidates) {
    const r = await tryParseFeed(parser, candidate);
    if (r && r.feedUrl) return { feedUrl: r.feedUrl, title: r.title };
    if (r && r.html && !homepageHtml) { homepageHtml = r.html; homepageUrl = r.finalUrl || candidate; }
  }

  // Parse declared feed links from the homepage HTML.
  if (homepageHtml) {
    const links = [...homepageHtml.matchAll(/<link[^>]+>/gi)]
      .map(m => m[0])
      .filter(t => /application\/(rss|atom)\+xml/i.test(t));
    for (const tag of links) {
      const href = (tag.match(/href=["']([^"']+)["']/i) || [])[1];
      if (!href) continue;
      const abs = href.startsWith('http') ? href : new URL(href, homepageUrl).href;
      const r = await tryParseFeed(parser, abs);
      if (r && r.feedUrl) return { feedUrl: r.feedUrl, title: r.title };
    }
  }
  return null;
}

async function fetchRssSource(source, userId, ctx, anthropic, insert) {
  const Parser = require('rss-parser');
  const parser = new Parser({ timeout: 15000, headers: { 'User-Agent': 'Stu Daily Brief' } });
  let added = 0, seen = 0;
  const feed = await parser.parseURL(source.feed_url);
  for (const it of (feed.items || []).slice(0, PER_SOURCE)) {
    const date = it.isoDate || it.pubDate || null;
    if (!isRecent(date)) continue;
    seen++;
    const raw = it['content:encoded'] || it.content || it.summary || '';
    const text = it.contentSnippet || stripHtml(raw);
    const messageId = `rss:${source.id}:${it.guid || it.link || it.title || Math.random()}`;
    const ok = await storeItem(userId, {
      message_id: messageId, sender: feed.title || source.name, fromName: feed.title || source.name,
      subject: it.title || '(untitled)', text, html: raw, url: it.link || '', date,
      sourceName: source.name || feed.title,
    }, ctx, anthropic, source.id, insert);
    if (ok) added++;
  }
  return { added, seen };
}

async function fetchEmailSenders(emailSources, userId, ctx, anthropic, insert) {
  const cfg = loadNewsletterConfig(userId);
  if (!cfg.address || !cfg.appPassword) return { added: 0, error: 'Gmail not configured for email sources' };
  let ImapFlow, simpleParser;
  try { ({ ImapFlow } = require('imapflow')); ({ simpleParser } = require('mailparser')); }
  catch (e) { return { added: 0, error: 'Email libs unavailable' }; }

  const client = new ImapFlow({ host: 'imap.gmail.com', port: 993, secure: true, auth: { user: cfg.address, pass: cfg.appPassword }, logger: false });
  let added = 0;
  try { await client.connect(); } catch (e) { return { added: 0, error: `Gmail connect failed: ${e.message}` }; }
  try {
    // Search across All Mail so archived newsletters are included.
    let boxes = [];
    try { boxes = await client.list(); } catch {}
    const allMail = boxes.find(b => b.specialUse === '\\All') || boxes.find(b => /all mail/i.test(b.path || '')) || { path: '[Gmail]/All Mail' };
    const lock = await client.getMailboxLock(allMail.path);
    try {
      const since = new Date(Date.now() - RECENT_DAYS * 86400000);
      for (const src of emailSources) {
        if (!src.sender_match) continue;
        let uids = [];
        try { uids = await client.search({ from: src.sender_match, since }, { uid: true }); } catch { uids = []; }
        if (!Array.isArray(uids)) uids = [];
        for (const uid of uids.slice(-PER_SOURCE)) {
          try {
            const msg = await client.fetchOne(uid, { source: true }, { uid: true });
            if (!msg || !msg.source) continue;
            const mail = await simpleParser(msg.source);
            const ok = await storeItem(userId, {
              message_id: mail.messageId || `uid:${uid}:${src.id}`,
              sender: mail.from?.text || src.sender_match, fromName: mail.from?.value?.[0]?.name || src.name,
              subject: mail.subject || '', text: mail.text || stripHtml(mail.html), html: mail.html, url: '',
              date: mail.date, sourceName: src.name,
            }, ctx, anthropic, src.id, insert);
            if (ok) added++;
          } catch { /* skip message */ }
        }
      }
    } finally { lock.release(); }
  } finally { try { await client.logout(); } catch {} }
  return { added };
}

// Main entry — pull every enabled source (RSS + email senders).
async function fetchAllSources(userId) {
  const sources = db.prepare(
    "SELECT * FROM newsletter_sources WHERE user_id = ? AND enabled = 1 AND is_deleted = 0"
  ).all(userId);
  if (sources.length === 0) {
    return { ok: false, error: 'No newsletter sources yet. Add some in Settings → Newsletters.' };
  }
  const anthropic = getAnthropic(userId);
  const ctx = buildRelevanceContext(userId);
  const insert = itemInsertStmt();

  let added = 0;
  const errors = [];
  const rssSources = sources.filter(s => s.type === 'rss' && s.feed_url);
  const emailSources = sources.filter(s => s.type === 'email' && s.sender_match);

  for (const src of rssSources) {
    try {
      const r = await fetchRssSource(src, userId, ctx, anthropic, insert);
      added += r.added;
      db.prepare('UPDATE newsletter_sources SET last_fetched = CURRENT_TIMESTAMP, last_status = ? WHERE id = ?')
        .run(`ok: +${r.added}`, src.id);
    } catch (e) {
      errors.push(`${src.name}: ${e.message}`);
      db.prepare('UPDATE newsletter_sources SET last_fetched = CURRENT_TIMESTAMP, last_status = ? WHERE id = ?')
        .run(`error: ${e.message}`.slice(0, 200), src.id);
    }
  }

  if (emailSources.length) {
    const r = await fetchEmailSenders(emailSources, userId, ctx, anthropic, insert);
    added += r.added || 0;
    if (r.error) errors.push(r.error);
  }

  // ok ONLY when every source succeeded — a partial failure must not read as green.
  const ok = errors.length === 0;
  return {
    ok, added, errors, sources: sources.length,
    failed: errors.length,
    error: ok ? null : `${errors.length} of ${sources.length} source(s) failed: ${errors.slice(0, 3).join(' | ')}`,
  };
}

module.exports = {
  fetchAndProcess, loadNewsletterConfig, scoreRelevance, buildRelevanceContext,
  fetchAllSources, discoverFeedUrl, canonUrl, normTitle,
};
