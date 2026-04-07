const express = require('express');
const router = express.Router();
const db = require('../db');

const RELATIONSHIP_STATUSES = ['Sourced', 'Outreach', 'Interviewing', 'Active', 'Hold', 'Passed', 'Not Admitted', 'Inactive'];
const ADMISSIONS_STATUSES = ['Sourced', 'Outreach', 'First Call Scheduled', 'First Call Complete', 'Second Call Scheduled', 'Second Call Complete', 'Admitted', 'Active Resident', 'Density Resident', 'Alumni', 'Hold/Nurture', 'Not Admitted'];
const DEAL_STATUSES = ['Under Consideration', 'First Meeting', 'Partner Call', 'Memo Draft', 'IC Review', 'Committed', 'Passed'];
const RESIDENT_STATUSES = ['Prospect', 'Tour Scheduled', 'Admitted', 'Active', 'Alumni']; // legacy

// GET /api/founders — list with filters
router.get('/', (req, res) => {
  const { search, status, domain, stage, source, minScore, sort, order, track, deal_status, resident_status, admissions_status } = req.query;
  let where = ['f.is_deleted = 0'];
  const params = [];
  where.push('f.created_by = ?'); params.push(req.user.id);

  if (search) {
    where.push("(f.name LIKE ? OR f.company LIKE ? OR f.email LIKE ? OR f.company_one_liner LIKE ?)");
    params.push(`%${search}%`, `%${search}%`, `%${search}%`, `%${search}%`);
  }
  if (status) { where.push('f.status = ?'); params.push(status); }
  if (domain) { where.push('f.domain = ?'); params.push(domain); }
  if (stage) { where.push('f.stage = ?'); params.push(stage); }
  if (source) { where.push('f.source = ?'); params.push(source); }
  if (minScore) { where.push('f.fit_score >= ?'); params.push(parseInt(minScore)); }

  // Track filters
  if (track === 'admissions') {
    where.push("f.pipeline_tracks LIKE '%admissions%'");
  } else if (track === 'resident') {
    where.push("(f.pipeline_tracks LIKE '%resident%' OR f.pipeline_tracks LIKE '%admissions%')");
  } else if (track === 'investment') {
    where.push("f.pipeline_tracks LIKE '%investment%'");
  }
  if (deal_status) { where.push('f.deal_status = ?'); params.push(deal_status); }
  if (resident_status) { where.push('f.resident_status = ?'); params.push(resident_status); }
  if (req.query.admissions_status) { where.push('f.admissions_status = ?'); params.push(req.query.admissions_status); }

  const sortCol = ['name', 'company', 'fit_score', 'status', 'created_at', 'updated_at', 'deal_status', 'deal_entered_at'].includes(sort) ? `f.${sort}` : 'f.updated_at';
  const sortDir = order === 'asc' ? 'ASC' : 'DESC';

  const sql = `SELECT f.*, u.name as created_by_name FROM founders f LEFT JOIN users u ON f.created_by = u.id WHERE ${where.join(' AND ')} ORDER BY ${sortCol} ${sortDir}`;
  const founders = db.prepare(sql).all(...params);
  res.json(founders);
});

// GET /api/founders/stats
router.get('/stats', (req, res) => {
  const total = db.prepare('SELECT COUNT(*) as c FROM founders WHERE is_deleted = 0 AND created_by = ?').get(req.user.id).c;
  const byStatus = db.prepare('SELECT status, COUNT(*) as count FROM founders WHERE is_deleted = 0 AND created_by = ? GROUP BY status').all(req.user.id);
  const byDomain = db.prepare('SELECT domain, COUNT(*) as count FROM founders WHERE is_deleted = 0 AND created_by = ? AND domain IS NOT NULL GROUP BY domain').all(req.user.id);
  const recentlyAdded = db.prepare('SELECT id, name, company, status, fit_score, pipeline_tracks, deal_status, resident_status, created_at FROM founders WHERE is_deleted = 0 AND created_by = ? ORDER BY created_at DESC LIMIT 5').all(req.user.id);
  const topScored = db.prepare('SELECT id, name, company, fit_score, status FROM founders WHERE is_deleted = 0 AND created_by = ? AND fit_score IS NOT NULL ORDER BY fit_score DESC LIMIT 5').all(req.user.id);
  const sourcedPending = db.prepare('SELECT COUNT(*) as c FROM sourced_founders WHERE status = ? AND user_id = ?').get('pending', req.user.id).c;

  // Track counts
  const admissions = db.prepare("SELECT COUNT(*) as c FROM founders WHERE is_deleted = 0 AND created_by = ? AND pipeline_tracks LIKE '%admissions%'").get(req.user.id).c;
  const residents = db.prepare("SELECT COUNT(*) as c FROM founders WHERE is_deleted = 0 AND created_by = ? AND (pipeline_tracks LIKE '%resident%' OR pipeline_tracks LIKE '%admissions%')").get(req.user.id).c;
  const investments = db.prepare("SELECT COUNT(*) as c FROM founders WHERE is_deleted = 0 AND created_by = ? AND pipeline_tracks LIKE '%investment%'").get(req.user.id).c;
  const byDealStatus = db.prepare("SELECT deal_status, COUNT(*) as count FROM founders WHERE is_deleted = 0 AND created_by = ? AND pipeline_tracks LIKE '%investment%' AND deal_status IS NOT NULL GROUP BY deal_status ORDER BY count DESC").all(req.user.id);
  const byResidentStatus = db.prepare("SELECT resident_status, COUNT(*) as count FROM founders WHERE is_deleted = 0 AND created_by = ? AND (pipeline_tracks LIKE '%resident%' OR pipeline_tracks LIKE '%admissions%') AND resident_status IS NOT NULL GROUP BY resident_status ORDER BY count DESC").all(req.user.id);
  const byAdmissionsStatus = db.prepare("SELECT admissions_status, COUNT(*) as count FROM founders WHERE is_deleted = 0 AND created_by = ? AND pipeline_tracks LIKE '%admissions%' AND admissions_status IS NOT NULL GROUP BY admissions_status ORDER BY count DESC").all(req.user.id);

  res.json({ total, byStatus, byDomain, recentlyAdded, topScored, sourcedPending, admissions, residents, investments, byDealStatus, byResidentStatus, byAdmissionsStatus });
});

// GET /api/founders/:id
router.get('/:id', (req, res) => {
  const founder = db.prepare('SELECT f.*, u.name as created_by_name FROM founders f LEFT JOIN users u ON f.created_by = u.id WHERE f.id = ? AND f.created_by = ? AND f.is_deleted = 0').get(req.params.id, req.user.id);
  if (!founder) return res.status(404).json({ error: 'Founder not found' });

  const notes = db.prepare('SELECT n.*, u.name as author FROM founder_notes n LEFT JOIN users u ON n.created_by = u.id WHERE n.founder_id = ? ORDER BY n.created_at DESC').all(req.params.id);
  const assessments = db.prepare('SELECT id, overall_signal, status, created_at FROM opportunity_assessments WHERE founder_id = ? ORDER BY created_at DESC').all(req.params.id);
  const calls = db.prepare('SELECT id, structured_summary, created_at FROM call_logs WHERE founder_id = ? ORDER BY created_at DESC').all(req.params.id);
  const deals = db.prepare('SELECT id, decision, created_at FROM deal_room WHERE founder_id = ? ORDER BY created_at DESC').all(req.params.id);

  res.json({ ...founder, notes, assessments, calls, deals });
});

// POST /api/founders
router.post('/', (req, res) => {
  const { name, company, role, email, linkedin_url, twitter, github_url, website_url, location_city, location_state, stage, domain, tags, status, source, bio, chicago_connection, previous_companies, notable_background, pipeline_tracks, resident_status, admissions_status, deal_status, company_one_liner, next_action, deal_lead, valuation, round_size, investment_amount, arr, monthly_burn, runway_months, security_type, memo_status, diligence_status, desks_needed } = req.body;
  if (!name) return res.status(400).json({ error: 'Name is required' });

  const result = db.prepare(`
    INSERT INTO founders (name, company, role, email, linkedin_url, twitter, github_url, website_url, location_city, location_state, stage, domain, tags, status, source, bio, chicago_connection, previous_companies, notable_background, pipeline_tracks, resident_status, admissions_status, deal_status, company_one_liner, next_action, deal_lead, valuation, round_size, investment_amount, arr, monthly_burn, runway_months, security_type, memo_status, diligence_status, desks_needed, deal_entered_at, admitted_at, created_by)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    name, company || null, role || null, email || null, linkedin_url || null, twitter || null, github_url || null, website_url || null,
    location_city || null, location_state || null, stage || 'Pre-seed', domain || null, tags || null, status || 'Sourced',
    source || null, bio || null, chicago_connection || null, previous_companies || null, notable_background || null,
    pipeline_tracks || '', resident_status || null, admissions_status || null, deal_status || null, company_one_liner || null, next_action || null,
    deal_lead || null, valuation || null, round_size || null, investment_amount || null, arr || null, monthly_burn || null,
    runway_months || null, security_type || null, memo_status || null, diligence_status || null, desks_needed || null,
    deal_status ? new Date().toISOString() : null,
    admissions_status === 'Admitted' || admissions_status === 'Active Resident' || resident_status === 'Admitted' || resident_status === 'Active' ? new Date().toISOString() : null,
    req.user.id
  );

  const founder = db.prepare('SELECT * FROM founders WHERE id = ?').get(result.lastInsertRowid);
  res.status(201).json(founder);
});

// PUT /api/founders/:id
router.put('/:id', (req, res) => {
  const founder = db.prepare('SELECT * FROM founders WHERE id = ? AND created_by = ? AND is_deleted = 0').get(req.params.id, req.user.id);
  if (!founder) return res.status(404).json({ error: 'Founder not found' });

  const fields = [
    'name', 'company', 'role', 'email', 'linkedin_url', 'twitter', 'github_url', 'website_url',
    'location_city', 'location_state', 'stage', 'domain', 'tags', 'status', 'source',
    'fit_score', 'fit_score_rationale', 'ai_summary', 'bio', 'chicago_connection',
    'previous_companies', 'notable_background',
    // Track fields
    'pipeline_tracks', 'resident_status', 'admissions_status', 'deal_status', 'deal_lead',
    'valuation', 'round_size', 'investment_amount', 'arr', 'monthly_burn', 'runway_months',
    'security_type', 'memo_status', 'diligence_status', 'pass_reason',
    'company_one_liner', 'next_action', 'desks_needed'
  ];
  const updates = [];
  const params = [];

  for (const field of fields) {
    if (req.body[field] !== undefined) {
      updates.push(`${field} = ?`);
      params.push(req.body[field]);
    }
  }

  // Auto-set deal_entered_at when investment track is first activated
  if (req.body.deal_status && !founder.deal_entered_at) {
    updates.push('deal_entered_at = CURRENT_TIMESTAMP');
  }
  // Auto-set admitted_at when resident status changes to Admitted
  if (req.body.resident_status === 'Admitted' && !founder.admitted_at) {
    updates.push('admitted_at = CURRENT_TIMESTAMP');
  }

  if (updates.length === 0) return res.status(400).json({ error: 'No fields to update' });

  updates.push('updated_at = CURRENT_TIMESTAMP');
  params.push(req.params.id, req.user.id);

  db.prepare(`UPDATE founders SET ${updates.join(', ')} WHERE id = ? AND created_by = ?`).run(...params);
  const updated = db.prepare('SELECT * FROM founders WHERE id = ?').get(req.params.id);

  // Fire-and-forget Airtable sync on stage changes
  try {
    const airtableSync = require('../services/airtable-sync');
    if (req.body.admissions_status && req.body.admissions_status !== founder.admissions_status) {
      airtableSync.pushAdmissionsChange(updated, founder.admissions_status).catch(err =>
        console.error('[AirtableSync] Admissions push failed:', err.message)
      );
    }
    if (req.body.deal_status && req.body.deal_status !== founder.deal_status) {
      airtableSync.pushDealChange(updated, founder.deal_status).catch(err =>
        console.error('[AirtableSync] Deal push failed:', err.message)
      );
    }
  } catch (syncErr) {
    console.error('[AirtableSync] Module load failed:', syncErr.message);
  }

  res.json(updated);
});

// DELETE /api/founders/:id (soft delete)
router.delete('/:id', (req, res) => {
  const founder = db.prepare('SELECT * FROM founders WHERE id = ? AND created_by = ? AND is_deleted = 0').get(req.params.id, req.user.id);
  if (!founder) return res.status(404).json({ error: 'Founder not found' });

  db.prepare('UPDATE founders SET is_deleted = 1, updated_at = CURRENT_TIMESTAMP WHERE id = ? AND created_by = ?').run(req.params.id, req.user.id);
  res.json({ message: 'Founder removed' });
});

// POST /api/founders/sync-airtable — trigger incremental Airtable → Stu sync
router.post('/sync-airtable', async (req, res) => {
  if (req.user.id !== 1) return res.status(403).json({ error: 'Airtable sync is not available for your account' });
  try {
    const { syncFromAirtable } = require('../services/airtable-import');
    const result = await syncFromAirtable();
    res.json(result);
  } catch (err) {
    console.error('[AirtableSync] Import failed:', err.message);
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
