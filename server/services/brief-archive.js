/**
 * Daily Brief — archive blogs ("learn from the greats").
 * =====================================================
 * The greats (Paul Graham, Bill Gurley, Andrew Chen, Elad Gil) have a treasure trove of
 * evergreen posts. We discover the FULL back-catalogue once, then resurface ONE per source
 * per day (rotating, no repeats) with Claude-distilled takeaways. Each source has a stable,
 * verified discovery path (static index or sitemap). Every step degrades gracefully — a
 * source that fails to discover or summarize is skipped, never breaking the digest.
 */
const db = require('../db');

const UA = 'Mozilla/5.0 (compatible; StuDailyBrief/1.0; +https://stu.vc)';

async function fetchPage(url) {
  try {
    const res = await fetch(url, { headers: { 'User-Agent': UA }, redirect: 'follow' });
    if (!res.ok) return null;
    return await res.text();
  } catch { return null; }
}

function stripHtml(s) {
  return String(s || '')
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/&#8217;|&#39;|&rsquo;/g, "'")
    .replace(/&#8220;|&#8221;|&ldquo;|&rdquo;/g, '"').replace(/&[a-z0-9#]+;/gi, ' ')
    .replace(/\s+/g, ' ').trim();
}

function titleFromSlug(url) {
  const m = String(url).replace(/\/+$/, '').split('/').pop() || '';
  return m.replace(/[-_]+/g, ' ').replace(/\b\w/g, c => c.toUpperCase()).slice(0, 120) || 'Untitled';
}

// ── Per-source discovery (returns [{url, title}]) ──────────────────────────────
const ARCHIVE_DEFS = {
  pg: {
    author: 'Paul Graham',
    label: 'Paul Graham Essays',
    async discover() {
      const html = await fetchPage('https://paulgraham.com/articles.html');
      if (!html) return [];
      const out = [];
      for (const m of html.matchAll(/<a href="([a-z0-9]+\.html)">([^<]+)<\/a>/gi)) {
        const slug = m[1].toLowerCase();
        if (['index.html', 'rss.html', 'articles.html', 'index2.html'].includes(slug)) continue;
        out.push({ url: 'https://paulgraham.com/' + m[1], title: stripHtml(m[2]) });
      }
      return out;
    },
  },
  gurley: {
    author: 'Bill Gurley',
    label: 'Above the Crowd (Bill Gurley)',
    async discover() {
      const xml = await fetchPage('https://abovethecrowd.com/post-sitemap.xml');
      if (!xml) return [];
      return [...xml.matchAll(/<loc>([^<]+)<\/loc>/gi)]
        .map(m => m[1])
        .filter(u => /\/\d{4}\/\d{2}\/\d{2}\//.test(u))
        .map(u => ({ url: u, title: titleFromSlug(u) }));
    },
  },
  chen: {
    author: 'Andrew Chen',
    label: 'Andrew Chen Essays',
    async discover() {
      const html = await fetchPage('https://andrewchen.com/sitemap/');
      if (!html) return [];
      const seen = new Set();
      const out = [];
      for (const m of html.matchAll(/<a href="(https?:\/\/andrewchen\.com\/([a-z0-9][a-z0-9-]{4,})\/)"[^>]*>([^<]{6,})<\/a>/gi)) {
        const url = m[1].replace('http://', 'https://');
        const slug = m[2];
        const title = stripHtml(m[3]);
        // Skip nav/utility pages.
        if (/^(subscribe|list-of-essays|recent|sitemap|about|contact|featured|books?|start-here|consulting)$/.test(slug)) continue;
        if (/^(subscribe|featured|recent|sitemap|home|about)$/i.test(title)) continue;
        if (seen.has(url)) continue;
        seen.add(url);
        out.push({ url, title });
      }
      return out;
    },
  },
  elad: {
    author: 'Elad Gil',
    label: 'High Growth Handbook (Elad Gil)',
    // The handbook's chapters/sections live at /book/... URLs, listed in the homepage nav.
    // We rotate through them one per day (a chapter/excerpt a day), not the whole book.
    async discover() {
      const html = await fetchPage('https://growth.eladgil.com/');
      if (!html) return [];
      const seen = new Set();
      const out = [];
      for (const m of html.matchAll(/<a[^>]+href="(https:\/\/growth\.eladgil\.com\/book\/[^"#]+)"[^>]*>([\s\S]*?)<\/a>/gi)) {
        const url = m[1].replace(/\/+$/, '/') ;
        const norm = url.replace(/\/+$/, '');
        if (seen.has(norm)) continue;
        seen.add(norm);
        const title = stripHtml(m[2]).slice(0, 200);
        out.push({ url, title: title || titleFromSlug(url) });
      }
      return out;
    },
  },
};

const ARCHIVE_KEYS = Object.keys(ARCHIVE_DEFS);

// ── Backfill: discover the full catalogue, insert rows we haven't seen ──────────
async function backfillArchive(userId, key) {
  const def = ARCHIVE_DEFS[key];
  if (!def) return { added: 0, error: 'unknown archive' };
  let posts;
  try { posts = await def.discover(); } catch (e) { return { added: 0, error: e.message }; }
  if (!posts || !posts.length) return { added: 0, error: 'discovery returned nothing' };
  const ins = db.prepare(
    'INSERT OR IGNORE INTO brief_archive_posts (user_id, archive_key, url, title, author) VALUES (?,?,?,?,?)'
  );
  let added = 0;
  const tx = db.transaction(() => {
    for (const p of posts) {
      const r = ins.run(userId, key, p.url, (p.title || titleFromSlug(p.url)).slice(0, 240), def.author);
      if (r.changes) added++;
    }
  });
  tx();
  return { added, total: posts.length };
}

async function backfillAll(userId, keys = ARCHIVE_KEYS) {
  const out = {};
  for (const k of keys) out[k] = await backfillArchive(userId, k);
  return out;
}

// ── Article extraction ─────────────────────────────────────────────────────────
async function extractArticle(url) {
  const html = await fetchPage(url);
  if (!html) return null;
  let title = '';
  const t = html.match(/<title>([^<]+)<\/title>/i) || html.match(/<h1[^>]*>([\s\S]*?)<\/h1>/i);
  if (t) title = stripHtml(t[1])
    .replace(/\s*(?:[\|–—-]|\bat\b|\bon\b)\s*(Above the Crowd|andrewchen(?:\.com)?|Paul Graham|High Growth Handbook|@andrewchen).*$/i, '')
    .trim();
  // Prefer the <article>/main content region if present, else whole body.
  const body = (html.match(/<article[\s\S]*?<\/article>/i) || [])[0]
    || (html.match(/<main[\s\S]*?<\/main>/i) || [])[0]
    || html;
  const text = stripHtml(body);
  return { title, text };
}

// ── Claude summarization ─────────────────────────────────────────────────────────
async function summarize(anthropic, { author, title, text }, { variety = '' } = {}) {
  if (!anthropic) return null;
  const body = (text || '').slice(0, 14000);
  if (body.length < 200) return null;
  try {
    const resp = await anthropic.messages.create({
      model: 'claude-sonnet-4-6',
      max_tokens: 600,
      system: `You distill an essay/chapter from a respected operator/investor into sharp, durable lessons for a venture investor who wants to learn from the greats. Be specific and non-generic — capture the actual argument, not platitudes.
Return ONLY JSON: {"one_liner":"<=140 chars, what this piece is really about","takeaways":["3-5 crisp, concrete lessons — each a full sentence a smart VC would underline"]}`,
      messages: [{ role: 'user', content: `AUTHOR: ${author}\nTITLE: ${title}\n${variety}\n\nTEXT:\n${body}` }],
    });
    const raw = resp.content[0].text.trim();
    const m = raw.match(/\{[\s\S]*\}/);
    if (!m) return null;
    const p = JSON.parse(m[0]);
    const takeaways = Array.isArray(p.takeaways) ? p.takeaways.filter(Boolean).slice(0, 5) : [];
    if (!takeaways.length) return null;
    return { one_liner: String(p.one_liner || '').slice(0, 200), takeaways };
  } catch { return null; }
}

// ── Pick the daily classic for a source ──────────────────────────────────────────
// Rotation: prefer never-shown (shown_at IS NULL), else the least-recently-shown (cycles
// back through the catalogue once exhausted). Fills content/summary lazily on first feature.
async function pickDailyClassic(userId, key, anthropic) {
  const def = ARCHIVE_DEFS[key];
  if (!def) return null;
  let row = db.prepare(
    'SELECT * FROM brief_archive_posts WHERE user_id = ? AND archive_key = ? AND shown_at IS NULL ORDER BY RANDOM() LIMIT 1'
  ).get(userId, key);
  if (!row) {
    row = db.prepare(
      'SELECT * FROM brief_archive_posts WHERE user_id = ? AND archive_key = ? ORDER BY shown_at ASC LIMIT 1'
    ).get(userId, key);
  }
  if (!row) return null;

  let article = row.content ? { title: row.title, text: row.content } : await extractArticle(row.url);
  if (!article) {
    // Mark as shown so a permanently-broken URL doesn't jam the rotation.
    db.prepare('UPDATE brief_archive_posts SET shown_at = CURRENT_TIMESTAMP WHERE id = ?').run(row.id);
    return null;
  }
  const title = (article.title && article.title.length > 3) ? article.title : row.title;
  const summary = await summarize(anthropic, { author: def.author, title, text: article.text });
  if (!summary) {
    db.prepare('UPDATE brief_archive_posts SET shown_at = CURRENT_TIMESTAMP WHERE id = ?').run(row.id);
    return null;
  }

  db.prepare('UPDATE brief_archive_posts SET shown_at = CURRENT_TIMESTAMP, title = ?, content = ?, summary = ? WHERE id = ?')
    .run(title.slice(0, 240), article.text.slice(0, 20000), JSON.stringify(summary), row.id);

  return { author: def.author, label: def.label, title, url: row.url, one_liner: summary.one_liner, takeaways: summary.takeaways };
}

module.exports = {
  ARCHIVE_DEFS, ARCHIVE_KEYS,
  backfillArchive, backfillAll, pickDailyClassic, extractArticle, summarize,
  // exported for tests
  _internal: { titleFromSlug, stripHtml },
};
