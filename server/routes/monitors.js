/**
 * routes/monitors.js — /api/monitors (web-session authed).
 * CRUD for signal monitors + their hits, plus a manual run. Same data layer the MCP
 * tools use (mcp/monitorData.js), so the web UI and an agent see identical state.
 */
const express = require('express');
const rateLimit = require('express-rate-limit');
const router = express.Router();
const data = require('../mcp/monitorData');
const { listMonitorTypes, runUserMonitors, runMonitorWithDiscovery } = require('../pipeline/monitor-engine');

// Active monitor runs trigger web discovery (Exa + LLM spend) — throttle them hard,
// on top of the per-user spend cap.
const runLimiter = rateLimit({ windowMs: 15 * 60 * 1000, max: 10, standardHeaders: true, legacyHeaders: false });

// GET /api/monitors/types — the catalog of monitor types you can create
router.get('/types', (req, res) => res.json(listMonitorTypes()));

// GET /api/monitors — your monitors (with new-hit counts)
router.get('/', (req, res) => res.json(data.listMonitors(req.user.id)));

// POST /api/monitors — create one
router.post('/', (req, res) => {
  try {
    const m = data.createMonitor(req.user.id, req.body || {});
    res.status(201).json(m);
  } catch (e) {
    res.status(e.status || 400).json({ error: e.message });
  }
});

// PATCH /api/monitors/:id — enable/disable
router.patch('/:id', (req, res) => {
  if (typeof req.body?.enabled === 'boolean') {
    const okSet = data.setEnabled(req.user.id, req.params.id, req.body.enabled);
    if (!okSet) return res.status(404).json({ error: 'Monitor not found' });
  }
  res.json(data.getMonitor(req.user.id, req.params.id) || { error: 'not found' });
});

// DELETE /api/monitors/:id
router.delete('/:id', (req, res) => {
  const okDel = data.deleteMonitor(req.user.id, req.params.id);
  if (!okDel) return res.status(404).json({ error: 'Monitor not found' });
  res.json({ success: true });
});

// POST /api/monitors/run — evaluate all of the user's monitors now (active ones discover)
router.post('/run', runLimiter, async (req, res) => {
  try { res.json({ results: await runUserMonitors(req.user.id) }); }
  catch (e) { res.status(500).json({ error: e.message }); }
});

// POST /api/monitors/:id/run — evaluate one monitor now
router.post('/:id/run', runLimiter, async (req, res) => {
  const m = data.getMonitor(req.user.id, req.params.id);
  if (!m) return res.status(404).json({ error: 'Monitor not found' });
  try { res.json(await runMonitorWithDiscovery(m)); }
  catch (e) { res.status(500).json({ error: e.message }); }
});

// GET /api/monitors/hits — recent hits across monitors (?monitorId, ?sinceDays, ?includeDismissed)
router.get('/hits', (req, res) => {
  res.json(data.listHits(req.user.id, {
    monitorId: req.query.monitorId,
    sinceDays: req.query.sinceDays,
    includeDismissed: req.query.includeDismissed === '1',
    limit: req.query.limit,
  }));
});

// POST /api/monitors/hits/:id/dismiss
router.post('/hits/:id/dismiss', (req, res) => {
  const okD = data.dismissHit(req.user.id, req.params.id);
  if (!okD) return res.status(404).json({ error: 'Hit not found' });
  res.json({ success: true });
});

module.exports = router;
