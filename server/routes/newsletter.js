const express = require('express');
const router = express.Router();
const db = require('../db');
const { fetchAndProcess, fetchAllSources, discoverFeedUrl, loadNewsletterConfig } = require('../services/newsletter');

// In-memory per-user sync state (running flag + last result).
const syncState = new Map();

function parseItem(row) {
  let key_points = [], matched = [];
  try { key_points = JSON.parse(row.key_points || '[]'); } catch {}
  try { matched = JSON.parse(row.matched_entities || '[]'); } catch {}
  return { ...row, key_points, matched_entities: matched };
}

// GET /api/newsletter/brief?days=4 — rolling multi-day newsfeed
router.get('/brief', (req, res) => {
  const days = Math.min(30, Math.max(1, parseInt(req.query.days) || 4));
  const rows = db.prepare(`
    SELECT * FROM newsletter_items
    WHERE user_id = ? AND is_deleted = 0
      AND (brief_date >= date('now','localtime', ?) OR brief_date IS NULL)
    ORDER BY relevance_score DESC, received_at DESC
  `).all(req.user.id, `-${days} days`);

  const items = rows.map(parseItem);
  const groups = { book: [], thesis: [], general: [] };
  for (const it of items) (groups[it.category] || groups.general).push(it);

  res.json({ days, total: items.length, groups, date: db.prepare("SELECT date('now','localtime') AS d").get().d });
});

// GET /api/newsletter/status — configured? running? last sync result?
router.get('/status', (req, res) => {
  const cfg = loadNewsletterConfig(req.user.id);
  const sourceCount = db.prepare('SELECT COUNT(*) c FROM newsletter_sources WHERE user_id = ? AND enabled = 1 AND is_deleted = 0').get(req.user.id).c;
  res.json({
    configured: sourceCount > 0 || !!(cfg.address && cfg.appPassword),
    sourceCount,
    gmailConnected: !!(cfg.address && cfg.appPassword),
    label: cfg.label,
    address: cfg.address || null,
    ...(syncState.get(req.user.id) || { running: false, last: null }),
  });
});

// ── Sources management ──
router.get('/sources', (req, res) => {
  const rows = db.prepare('SELECT * FROM newsletter_sources WHERE user_id = ? AND is_deleted = 0 ORDER BY created_at DESC').all(req.user.id);
  res.json(rows);
});

// POST /api/newsletter/sources — add an RSS feed (by URL, auto-discovered) or email sender
router.post('/sources', async (req, res) => {
  const { name, type, url, sender } = req.body || {};
  const t = type === 'email' ? 'email' : 'rss';
  try {
    if (t === 'email') {
      if (!sender) return res.status(400).json({ error: 'Sender email required for an email source.' });
      const r = db.prepare('INSERT INTO newsletter_sources (user_id, name, type, sender_match, enabled) VALUES (?, ?, "email", ?, 1)')
        .run(req.user.id, name || sender, sender.trim());
      return res.json(db.prepare('SELECT * FROM newsletter_sources WHERE id = ?').get(r.lastInsertRowid));
    }
    if (!url) return res.status(400).json({ error: 'A newsletter URL or RSS feed is required.' });
    const found = await discoverFeedUrl(url);
    if (!found) return res.status(422).json({ error: `Couldn't find an RSS feed at "${url}". Try the newsletter's Substack/site URL, or add it as an email source instead.` });
    const r = db.prepare('INSERT INTO newsletter_sources (user_id, name, type, feed_url, enabled) VALUES (?, ?, "rss", ?, 1)')
      .run(req.user.id, name || found.title || url, found.feedUrl);
    res.json(db.prepare('SELECT * FROM newsletter_sources WHERE id = ?').get(r.lastInsertRowid));
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// PATCH /api/newsletter/sources/:id — toggle enabled / rename
router.patch('/sources/:id', (req, res) => {
  const existing = db.prepare('SELECT * FROM newsletter_sources WHERE id = ? AND user_id = ? AND is_deleted = 0').get(req.params.id, req.user.id);
  if (!existing) return res.status(404).json({ error: 'Not found' });
  const updates = [], params = [];
  if ('enabled' in req.body) { updates.push('enabled = ?'); params.push(req.body.enabled ? 1 : 0); }
  if ('name' in req.body) { updates.push('name = ?'); params.push(req.body.name); }
  if (!updates.length) return res.json(existing);
  params.push(req.params.id, req.user.id);
  db.prepare(`UPDATE newsletter_sources SET ${updates.join(', ')} WHERE id = ? AND user_id = ?`).run(...params);
  res.json(db.prepare('SELECT * FROM newsletter_sources WHERE id = ?').get(req.params.id));
});

router.delete('/sources/:id', (req, res) => {
  db.prepare('UPDATE newsletter_sources SET is_deleted = 1 WHERE id = ? AND user_id = ?').run(req.params.id, req.user.id);
  res.json({ success: true });
});

// POST /api/newsletter/sync — pull the Gmail label, extract, rank (background)
router.post('/sync', (req, res) => {
  const userId = req.user.id;
  const state = syncState.get(userId);
  if (state && state.running) return res.json({ started: false, running: true });

  const cfg = loadNewsletterConfig(userId);
  const sourceCount = db.prepare('SELECT COUNT(*) c FROM newsletter_sources WHERE user_id = ? AND enabled = 1 AND is_deleted = 0').get(userId).c;
  if (sourceCount === 0 && (!cfg.address || !cfg.appPassword)) {
    return res.status(400).json({ error: 'Add a newsletter source (RSS feed) in Settings, or connect Gmail for email sources.' });
  }

  syncState.set(userId, { running: true, last: state?.last || null });
  res.json({ started: true });

  // Prefer the managed sources list (RSS + email senders). Fall back to the Gmail
  // label path only if no sources are configured yet (legacy setup).
  const runner = sourceCount > 0 ? fetchAllSources(userId) : fetchAndProcess(userId, { limit: 40 });

  // Fire-and-forget; record result in memory for /status.
  const { recordJobRun } = require('../services/health');
  runner
    .then(r => {
      syncState.set(userId, {
        running: false,
        last: { at: new Date().toISOString(), ...r },
      });
      const status = r.ok ? 'ok' : (r.added > 0 ? 'partial' : 'error');
      recordJobRun('newsletter_sync', status, r.ok ? `+${r.added} added` : (r.error || 'failed'), userId);
      console.log(`[Newsletter] sync user ${userId}:`, r.ok ? `${r.added} added` : r.error);
    })
    .catch(err => {
      syncState.set(userId, { running: false, last: { at: new Date().toISOString(), ok: false, error: err.message } });
      recordJobRun('newsletter_sync', 'error', err.message, userId);
      console.error(`[Newsletter] sync user ${userId} failed:`, err.message);
    });
});

// POST /api/newsletter/:id/read — mark read/unread
router.post('/:id/read', (req, res) => {
  const read = req.body?.read === false ? 0 : 1;
  db.prepare('UPDATE newsletter_items SET is_read = ? WHERE id = ? AND user_id = ?').run(read, req.params.id, req.user.id);
  res.json({ success: true });
});

// DELETE /api/newsletter/:id — dismiss from the brief
router.delete('/:id', (req, res) => {
  db.prepare('UPDATE newsletter_items SET is_deleted = 1 WHERE id = ? AND user_id = ?').run(req.params.id, req.user.id);
  res.json({ success: true });
});

module.exports = router;
