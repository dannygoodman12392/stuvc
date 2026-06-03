/**
 * Stu → Notion (Strider OS) sync service
 *
 * Pushes a Stu founder into Danny's private Strider Founders DB on first
 * "Add to Investment Pipeline" click, and keeps Stu-canonical fields in sync
 * on subsequent updates. Notion-canonical fields (Strider Stage, Conviction
 * Score, Notes, Personal Check) are NEVER overwritten once set.
 *
 * Idempotent: dedupes by SS Record ID = Stu founder.id. Same founder synced
 * twice = update, not duplicate.
 *
 * Fire-and-forget — errors logged, never block the Stu PUT response.
 */

const https = require('https');

const NOTION_TOKEN = process.env.NOTION_API_KEY || process.env.NOTION_TOKEN;
const NOTION_FOUNDERS_DB_ID = process.env.NOTION_FOUNDERS_DB_ID;
const NOTION_VERSION = '2022-06-28';

function notionRequest(method, path, body) {
  return new Promise((resolve, reject) => {
    const data = body ? JSON.stringify(body) : null;
    const options = {
      hostname: 'api.notion.com',
      path,
      method,
      headers: {
        'Authorization': `Bearer ${NOTION_TOKEN}`,
        'Notion-Version': NOTION_VERSION,
        'Content-Type': 'application/json',
      },
    };
    if (data) options.headers['Content-Length'] = Buffer.byteLength(data);

    const req = https.request(options, (res) => {
      let chunks = '';
      res.on('data', chunk => chunks += chunk);
      res.on('end', () => {
        if (res.statusCode >= 200 && res.statusCode < 300) {
          try { resolve(chunks ? JSON.parse(chunks) : {}); }
          catch (e) { reject(new Error(`Notion parse error: ${e.message} body=${chunks.slice(0,200)}`)); }
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

async function findFounderByStuId(stuId) {
  const res = await notionRequest('POST', `/v1/databases/${NOTION_FOUNDERS_DB_ID}/query`, {
    filter: {
      property: 'SS Record ID',
      rich_text: { equals: String(stuId) }
    },
    page_size: 1,
  });
  return (res.results && res.results[0]) || null;
}

function normalizeUrl(value) {
  if (!value) return null;
  const v = String(value).trim();
  if (!v) return null;
  if (/^https?:\/\//i.test(v)) return v;
  return `https://${v}`;
}

function mapStage(stuStage) {
  if (!stuStage) return null;
  const k = String(stuStage).toLowerCase().trim();
  // Order matters: bootstrap/pre-raise checked before "pre" alone
  if (k.includes('bootstrap') || k.includes('pre-raise') || k.includes('preraise')) return 'Bootstrapped / Pre-Raise';
  if (k.includes('pre-seed') || k.includes('preseed') || k === 'pre seed') return 'Pre-seed';
  if (k.includes('series') || k === 'a' || k === 'b') return null; // out of scope, leave blank
  if (k.includes('seed')) return 'Seed';
  if (k.includes('idea')) return 'Pre-idea';
  if (k === 'service' || k.includes('service')) return 'Service';
  return null;
}

function buildLocation(city, state) {
  if (city && state) return `${city}, ${state}`;
  return city || state || null;
}

function truncate(text, max) {
  if (!text) return text;
  const s = String(text);
  return s.length > max ? s.slice(0, max - 3) + '...' : s;
}

function buildInitialNotes(founder) {
  const lines = [`Sourced via Stu.vc on ${new Date().toISOString().slice(0, 10)}.`];
  if (founder.fit_score) lines.push(`Stu fit score: ${founder.fit_score}/10.`);
  if (founder.fit_score_rationale) lines.push(`Stu rationale: ${founder.fit_score_rationale}`);
  if (founder.source) lines.push(`Stu source: ${founder.source}`);
  if (founder.bio) lines.push(`Bio: ${founder.bio}`);
  if (founder.chicago_connection) lines.push(`Chicago connection: ${founder.chicago_connection}`);
  if (founder.previous_companies) lines.push(`Previous companies: ${founder.previous_companies}`);
  if (founder.notable_background) lines.push(`Notable background: ${founder.notable_background}`);
  return lines.join('\n\n');
}

function buildProperties(founder, isCreate) {
  // Notion property keys must match the Founders DB schema EXACTLY (case-sensitive)
  const props = {
    'Name': { title: [{ text: { content: truncate(founder.name || 'Unnamed', 2000) } }] },
    'SS Record ID': { rich_text: [{ text: { content: String(founder.id) } }] },
  };

  if (founder.company) {
    props['Company'] = { rich_text: [{ text: { content: truncate(founder.company, 2000) } }] };
  }

  // Stu's `website_url` is the actual URL; `domain` is a sector classification
  // (e.g. "Enterprise Tech", "Health Tech"). Map them to the right Notion fields.
  const url = normalizeUrl(founder.website_url);
  if (url) props['Company URL'] = { url };

  if (founder.domain) {
    props['Sector'] = { rich_text: [{ text: { content: truncate(founder.domain, 2000) } }] };
  }

  const loc = buildLocation(founder.location_city, founder.location_state);
  if (loc) props['Location'] = { rich_text: [{ text: { content: truncate(loc, 2000) } }] };

  const stage = mapStage(founder.stage);
  if (stage) props['Stage'] = { select: { name: stage } };

  if (founder.source) {
    props['Source'] = { rich_text: [{ text: { content: truncate(`Stu.vc / ${founder.source}`, 2000) } }] };
  } else {
    props['Source'] = { rich_text: [{ text: { content: 'Stu.vc' } }] };
  }

  if (isCreate) {
    // Notion-canonical defaults — set once on creation, never overwritten by Stu
    props['Strider Stage'] = { select: { name: 'Discovered' } };
    props['SS Status'] = { select: { name: 'Active' } };
    props['Date Added to Strider'] = { date: { start: new Date().toISOString().slice(0, 10) } };

    const notes = buildInitialNotes(founder);
    if (notes) {
      props['Notes'] = { rich_text: [{ text: { content: truncate(notes, 1900) } }] };
    }
  }
  // On update: Strider Stage, Notes, Conviction Score, Personal Check, etc. are
  // intentionally OMITTED so we don't overwrite Danny's manual edits in Notion.

  return props;
}

// Retry transient failures (network/5xx/429) with backoff; surface the rest.
async function withRetry(fn, label, tries = 3) {
  let lastErr;
  for (let i = 0; i < tries; i++) {
    try { return await fn(); }
    catch (e) {
      lastErr = e;
      const transient = /timeout|etimedout|econnreset|fetch failed|socket|\b5\d\d\b|429/i.test(e.message || '');
      if (!transient || i === tries - 1) throw e;
      console.warn(`[NotionSync] transient failure (${label}), retry ${i + 1}/${tries - 1}: ${e.message}`);
      await new Promise(r => setTimeout(r, 400 * (i + 1)));
    }
  }
  throw lastErr;
}

async function pushFounderToNotion(founder) {
  if (!NOTION_TOKEN || !NOTION_FOUNDERS_DB_ID) {
    console.warn('[NotionSync] NOTION_API_KEY/NOTION_TOKEN or NOTION_FOUNDERS_DB_ID not set — skipping');
    return null;
  }
  if (!founder || !founder.id || !founder.name) {
    console.warn(`[NotionSync] Invalid founder payload (id=${founder && founder.id}) — skipping`);
    return null;
  }

  try {
    const existing = await withRetry(() => findFounderByStuId(founder.id), 'lookup');
    if (existing) {
      await withRetry(() => notionRequest('PATCH', `/v1/pages/${existing.id}`, { properties: buildProperties(founder, false) }), 'update');
    } else {
      await withRetry(() => notionRequest('POST', '/v1/pages', {
        parent: { database_id: NOTION_FOUNDERS_DB_ID },
        properties: buildProperties(founder, true),
      }), 'create');
    }
    // Read-back verification: confirm the page is actually there after the write.
    const verify = await withRetry(() => findFounderByStuId(founder.id), 'verify');
    if (!verify) throw new Error('read-back verification failed: page not found after push');
    console.log(`[NotionSync] ✓ ${existing ? 'updated' : 'created'} + verified ${founder.name}`);
    return verify;
  } catch (err) {
    console.error(`[NotionSync] ✗ ${founder.name} sync failed: ${err.message}`);
    throw err;
  }
}

// Drift check: every investment-track founder in SQLite (canonical) should have a Notion
// page. Returns missing/errored ones. With { repair: true }, re-pushes the missing from
// canonical (SQLite is always the source of truth — we never pull Notion edits back here).
async function checkNotionDrift(userId, { repair = false } = {}) {
  if (!NOTION_TOKEN || !NOTION_FOUNDERS_DB_ID) return { configured: false, checked: 0, missing: [], repaired: 0 };
  const db = require('../db');
  const founders = db.prepare(
    "SELECT * FROM founders WHERE created_by = ? AND is_deleted = 0 AND pipeline_tracks LIKE '%investment%'"
  ).all(userId);
  const missing = [];
  let repaired = 0;
  for (const f of founders) {
    try {
      const page = await withRetry(() => findFounderByStuId(f.id), 'drift-lookup');
      if (!page) {
        missing.push({ id: f.id, name: f.name });
        if (repair) { try { await pushFounderToNotion(f); repaired++; } catch (e) { /* leave in missing */ } }
      }
    } catch (e) {
      missing.push({ id: f.id, name: f.name, error: e.message });
    }
  }
  return { configured: true, checked: founders.length, missing, repaired, ok: missing.length === 0 || repaired === missing.length };
}

module.exports = { pushFounderToNotion, findFounderByStuId, checkNotionDrift };
