const express = require('express');
const router = express.Router();
const db = require('../db');

// GET /api/home — one aggregated payload for the logged-in dashboard.
// Every section is guarded so a single failing query can't blank the page.
router.get('/', (req, res) => {
  const uid = req.user.id;
  const out = { nextActions: [], sourcing: {}, talent: {}, brief: {}, pipeline: {} };
  const safe = (fn, fallback) => { try { return fn(); } catch { return fallback; } };

  // ── Sourcing glimpse ──
  out.sourcing = safe(() => {
    const rank = `CASE caliber_tier WHEN 'S' THEN 4 WHEN 'A' THEN 3 WHEN 'B' THEN 2 ELSE 1 END`;
    const top = db.prepare(`
      SELECT id, name, company, company_one_liner, caliber_tier, confidence_score, chicago_connection, linkedin_url
      FROM sourced_founders WHERE user_id = ? AND status = 'pending'
      ORDER BY ${rank} DESC, confidence_score DESC, created_at DESC LIMIT 5
    `).all(uid);
    const pending = db.prepare("SELECT COUNT(*) c FROM sourced_founders WHERE user_id = ? AND status = 'pending'").get(uid).c;
    const sa = db.prepare("SELECT COUNT(*) c FROM sourced_founders WHERE user_id = ? AND status = 'pending' AND caliber_tier IN ('S','A')").get(uid).c;
    return { topFounders: top, pending, topCaliber: sa };
  }, { topFounders: [], pending: 0, topCaliber: 0 });

  // ── Talent glimpse ──
  out.talent = safe(() => {
    const roles = db.prepare(`
      SELECT r.id, r.title, r.band, c.name AS company_name,
        (SELECT COUNT(*) FROM talent_matches m WHERE m.role_id = r.id AND m.status = 'suggested' AND m.is_deleted = 0) AS newMatches
      FROM talent_roles r
      LEFT JOIN talent_portfolio_companies c ON r.portfolio_company_id = c.id
      WHERE r.user_id = ? AND r.is_deleted = 0 AND r.status = 'open'
      ORDER BY newMatches DESC, r.priority = 'urgent' DESC LIMIT 5
    `).all(uid);
    const totalNew = db.prepare("SELECT COUNT(*) c FROM talent_matches WHERE user_id = ? AND status = 'suggested' AND is_deleted = 0").get(uid).c;
    return { openRoles: roles, totalNewMatches: totalNew };
  }, { openRoles: [], totalNewMatches: 0 });

  // ── Daily Brief glimpse (top relevant, last 4 days) ──
  out.brief = safe(() => {
    const rows = db.prepare(`
      SELECT id, source_name, subject, summary, url, relevance_score, received_at
      FROM newsletter_items
      WHERE user_id = ? AND is_deleted = 0 AND (brief_date >= date('now','localtime','-4 days') OR brief_date IS NULL)
      ORDER BY relevance_score DESC, received_at DESC LIMIT 3
    `).all(uid);
    return { topItems: rows };
  }, { topItems: [] });

  // ── Pipeline pulse ──
  out.pipeline = safe(() => {
    const total = db.prepare("SELECT COUNT(*) c FROM founders WHERE created_by = ? AND is_deleted = 0").get(uid).c;
    const active = db.prepare("SELECT COUNT(*) c FROM founders WHERE created_by = ? AND is_deleted = 0 AND status NOT IN ('Sourced','Passed','Dismissed')").get(uid).c;
    return { total, active };
  }, { total: 0, active: 0 });

  // ── Next actions (the "what needs you today" strip) ──
  safe(() => {
    if (out.sourcing.topCaliber > 0) {
      out.nextActions.push({ type: 'sourcing', label: `Review ${out.sourcing.topCaliber} top-caliber founder${out.sourcing.topCaliber === 1 ? '' : 's'}`, link: '/pipeline' , cta: 'Inbox' });
    }
    const newAssess = db.prepare("SELECT COUNT(*) c FROM opportunity_assessments WHERE created_by = ? AND status = 'complete' AND is_deleted = 0 AND updated_at >= datetime('now','-3 days')").get(uid).c;
    if (newAssess > 0) out.nextActions.push({ type: 'assessment', label: `${newAssess} assessment${newAssess === 1 ? '' : 's'} completed recently`, link: '/assess', cta: 'View' });
    if (out.talent.totalNewMatches > 0) out.nextActions.push({ type: 'talent', label: `${out.talent.totalNewMatches} new candidate match${out.talent.totalNewMatches === 1 ? '' : 'es'} to review`, link: '/talent/matches', cta: 'Review' });
    const stale = db.prepare("SELECT COUNT(*) c FROM founders WHERE created_by = ? AND is_deleted = 0 AND status NOT IN ('Sourced','Passed','Dismissed','Committed') AND updated_at < datetime('now','-14 days')").get(uid).c;
    if (stale > 0) out.nextActions.push({ type: 'stale', label: `${stale} active deal${stale === 1 ? '' : 's'} going quiet (14d+)`, link: '/', cta: 'Pipeline' });
  });

  out.user = { name: req.user.name || null };
  res.json(out);
});

module.exports = router;
