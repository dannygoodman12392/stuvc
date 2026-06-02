const express = require('express');
const router = express.Router();
const db = require('../db');

// GET /api/home — a calm, content-first morning dashboard.
// Three things a partner wants on login: relevant news, a look at the pipeline,
// and portfolio-support (hiring) tasks. No follow-up nags, no "you must act" noise.
router.get('/', (req, res) => {
  const uid = req.user.id;
  const out = { brief: {}, pipeline: {}, sourcing: {}, talent: {}, user: { name: req.user.name || null } };
  const safe = (fn, fallback) => { try { return fn(); } catch { return fallback; } };

  // ── Catch up: most relevant newsletter items (last 4 days) ──
  out.brief = safe(() => {
    const rows = db.prepare(`
      SELECT id, source_name, subject, summary, key_points, url, relevance_score, category, received_at
      FROM newsletter_items
      WHERE user_id = ? AND is_deleted = 0 AND (brief_date >= date('now','localtime','-4 days') OR brief_date IS NULL)
      ORDER BY relevance_score DESC, received_at DESC LIMIT 6
    `).all(uid).map(r => { try { r.key_points = JSON.parse(r.key_points || '[]'); } catch { r.key_points = []; } return r; });
    const total = db.prepare(`SELECT COUNT(*) c FROM newsletter_items WHERE user_id = ? AND is_deleted = 0 AND (brief_date >= date('now','localtime','-4 days') OR brief_date IS NULL)`).get(uid).c;
    return { topItems: rows, total };
  }, { topItems: [], total: 0 });

  // ── Have a look: the active pipeline + what's new in the inbox ──
  out.pipeline = safe(() => {
    const active = db.prepare(`
      SELECT id, name, company, status, caliber_tier, domain
      FROM founders WHERE created_by = ? AND is_deleted = 0
        AND status NOT IN ('Sourced','Passed','Dismissed')
      ORDER BY updated_at DESC LIMIT 6
    `).all(uid);
    const activeCount = db.prepare("SELECT COUNT(*) c FROM founders WHERE created_by = ? AND is_deleted = 0 AND status NOT IN ('Sourced','Passed','Dismissed')").get(uid).c;
    return { active, activeCount };
  }, { active: [], activeCount: 0 });

  out.sourcing = safe(() => {
    const pending = db.prepare("SELECT COUNT(*) c FROM sourced_founders WHERE user_id = ? AND status = 'pending'").get(uid).c;
    const topCaliber = db.prepare("SELECT COUNT(*) c FROM sourced_founders WHERE user_id = ? AND status = 'pending' AND caliber_tier IN ('S','A')").get(uid).c;
    return { pending, topCaliber };
  }, { pending: 0, topCaliber: 0 });

  // ── Portfolio support: open roles + candidate matches waiting ──
  out.talent = safe(() => {
    const roles = db.prepare(`
      SELECT r.id, r.title, r.band, c.name AS company_name,
        (SELECT COUNT(*) FROM talent_matches m WHERE m.role_id = r.id AND m.status = 'suggested' AND m.is_deleted = 0) AS newMatches
      FROM talent_roles r
      LEFT JOIN talent_portfolio_companies c ON r.portfolio_company_id = c.id
      WHERE r.user_id = ? AND r.is_deleted = 0 AND r.status = 'open'
      ORDER BY newMatches DESC LIMIT 6
    `).all(uid);
    return { openRoles: roles };
  }, { openRoles: [] });

  res.json(out);
});

module.exports = router;
