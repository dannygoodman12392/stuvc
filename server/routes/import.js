const express = require('express');
const router = express.Router();
const multer = require('multer');
const path = require('path');
const db = require('../db');
const { parseCSV, MAPPABLE_FIELDS } = require('../services/csv-parser');
const { extractFromPDF } = require('../services/pdf-extractor');
const { enrichWithLinkedIn } = require('../pipeline/sourcing-engine');

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 10 * 1024 * 1024 }, // 10MB
  fileFilter: (req, file, cb) => {
    const ext = path.extname(file.originalname).toLowerCase();
    if (['.csv', '.pdf'].includes(ext)) {
      cb(null, true);
    } else {
      cb(new Error('Only CSV and PDF files are supported'));
    }
  },
});

// GET /api/import/fields — available mapping fields
router.get('/fields', (req, res) => {
  res.json(MAPPABLE_FIELDS);
});

// POST /api/import/upload — parse CSV or PDF, return preview + mappings
router.post('/upload', upload.single('file'), async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ error: 'No file uploaded' });
    }

    const ext = path.extname(req.file.originalname).toLowerCase();

    if (ext === '.csv') {
      const result = parseCSV(req.file.buffer);
      return res.json({
        type: 'csv',
        fileName: req.file.originalname,
        headers: result.headers,
        mappings: result.mappings,
        rows: result.rows,
        rowCount: result.rowCount,
        fields: MAPPABLE_FIELDS,
      });
    }

    if (ext === '.pdf') {
      // Get user's Anthropic API key
      const setting = db.prepare(
        "SELECT setting_value FROM user_settings WHERE user_id = ? AND setting_key = 'api_key_anthropic'"
      ).get(req.user.id);

      const apiKey = setting?.setting_value?.replace(/^"|"$/g, '') || process.env.ANTHROPIC_API_KEY;
      if (!apiKey) {
        return res.status(400).json({ error: 'An Anthropic API key is required for PDF import. Add it in Settings.' });
      }

      const rows = await extractFromPDF(req.file.buffer, apiKey);
      return res.json({
        type: 'pdf',
        fileName: req.file.originalname,
        headers: [],
        mappings: {},
        rows,
        rowCount: rows.length,
        fields: MAPPABLE_FIELDS,
      });
    }

    res.status(400).json({ error: 'Unsupported file type' });
  } catch (err) {
    console.error('[Import] Upload error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

// POST /api/import/remap — re-apply column mappings on CSV data
router.post('/remap', (req, res) => {
  const { rows, mappings } = req.body;
  if (!rows || !mappings) {
    return res.status(400).json({ error: 'Missing rows or mappings' });
  }

  const remapped = rows.map((row, idx) => {
    const founder = { _row: idx + 1 };
    const raw = row._raw || row;
    let firstName = '';
    let lastName = '';

    for (const [header, field] of Object.entries(mappings)) {
      if (!field || !raw[header]) continue;
      const val = (raw[header] || '').trim();
      if (!val) continue;

      if (field === '__first_name') {
        firstName = val;
      } else if (field === '__last_name') {
        lastName = val;
      } else {
        founder[field] = val;
      }
    }

    if (firstName || lastName) {
      founder.name = [firstName, lastName].filter(Boolean).join(' ');
    }
    founder._raw = raw;
    return founder;
  }).filter(r => {
    const keys = Object.keys(r).filter(k => !k.startsWith('_'));
    return keys.length > 0;
  });

  res.json({ rows: remapped, rowCount: remapped.length });
});

// POST /api/import/confirm — bulk insert founders
router.post('/confirm', (req, res) => {
  const { founders, source } = req.body;
  if (!founders || !Array.isArray(founders) || founders.length === 0) {
    return res.status(400).json({ error: 'No founders to import' });
  }
  if (founders.length > 500) {
    return res.status(400).json({ error: 'Maximum 500 founders per import' });
  }

  const userId = req.user.id;
  const importSource = source || 'csv-import';

  // Check for duplicates by linkedin_url and email
  const existingLinkedins = new Set();
  const existingEmails = new Set();

  const linkedinRows = db.prepare(
    'SELECT linkedin_url FROM founders WHERE created_by = ? AND is_deleted = 0 AND linkedin_url IS NOT NULL'
  ).all(userId);
  for (const r of linkedinRows) existingLinkedins.add(r.linkedin_url.toLowerCase());

  const emailRows = db.prepare(
    'SELECT email FROM founders WHERE created_by = ? AND is_deleted = 0 AND email IS NOT NULL'
  ).all(userId);
  for (const r of emailRows) existingEmails.add(r.email.toLowerCase());

  const insert = db.prepare(`
    INSERT INTO founders (
      name, company, role, email, linkedin_url, twitter, github_url, website_url,
      location_city, location_state, domain, stage, tags, company_one_liner,
      bio, source, fit_score, previous_companies, notable_background,
      status, pipeline_tracks, admissions_status, created_by, created_at, updated_at
    ) VALUES (
      ?, ?, ?, ?, ?, ?, ?, ?,
      ?, ?, ?, ?, ?, ?,
      ?, ?, ?, ?, ?,
      'Sourced', 'admissions', 'Sourced', ?, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
    )
  `);

  const results = { imported: 0, skipped: 0, duplicates: [] };

  const bulkInsert = db.transaction(() => {
    for (const f of founders) {
      if (!f.name && !f.company) {
        results.skipped++;
        continue;
      }

      // Duplicate check
      const isDupe =
        (f.linkedin_url && existingLinkedins.has(f.linkedin_url.toLowerCase())) ||
        (f.email && existingEmails.has(f.email.toLowerCase()));

      if (isDupe) {
        results.duplicates.push(f.name || f.company || 'Unknown');
        results.skipped++;
        continue;
      }

      // Normalize tags
      let tags = f.tags;
      if (tags && typeof tags === 'string') {
        try { JSON.parse(tags); } catch {
          tags = JSON.stringify(tags.split(',').map(t => t.trim()).filter(Boolean));
        }
      }

      insert.run(
        f.name || null,
        f.company || null,
        f.role || null,
        f.email || null,
        f.linkedin_url || null,
        f.twitter || null,
        f.github_url || null,
        f.website_url || null,
        f.location_city || null,
        f.location_state || null,
        f.domain || null,
        f.stage || 'Pre-seed',
        tags || null,
        f.company_one_liner || null,
        f.bio || null,
        importSource,
        f.fit_score ? parseInt(f.fit_score, 10) || null : null,
        f.previous_companies || null,
        f.notable_background || null,
        userId
      );

      // Track for in-batch dedup
      if (f.linkedin_url) existingLinkedins.add(f.linkedin_url.toLowerCase());
      if (f.email) existingEmails.add(f.email.toLowerCase());
      results.imported++;
    }
  });

  try {
    bulkInsert();
    res.json(results);
  } catch (err) {
    console.error('[Import] Bulk insert error:', err.message);
    res.status(500).json({ error: 'Failed to import founders: ' + err.message });
  }
});

// POST /api/import/enrich — enrich imported founders that have linkedin_url
router.post('/enrich', async (req, res) => {
  const { founderIds } = req.body;
  const userId = req.user.id;

  // Get user's EnrichLayer API key
  const setting = db.prepare(
    "SELECT setting_value FROM user_settings WHERE user_id = ? AND setting_key = 'api_key_enrichlayer'"
  ).get(userId);
  const apiKey = setting?.setting_value?.replace(/^"|"$/g, '') || process.env.ENRICHLAYER_API_KEY;

  if (!apiKey) {
    return res.status(400).json({ error: 'An EnrichLayer API key is required for enrichment. Add it in Settings.' });
  }

  // Get founders to enrich (must belong to user, have linkedin_url)
  let founders;
  if (founderIds && founderIds.length > 0) {
    const placeholders = founderIds.map(() => '?').join(',');
    founders = db.prepare(
      `SELECT id, linkedin_url FROM founders WHERE id IN (${placeholders}) AND created_by = ? AND is_deleted = 0 AND linkedin_url IS NOT NULL`
    ).all(...founderIds, userId);
  } else {
    // Enrich most recent imports that haven't been enriched yet
    founders = db.prepare(
      `SELECT id, linkedin_url FROM founders
       WHERE created_by = ? AND is_deleted = 0 AND linkedin_url IS NOT NULL
       AND source IN ('csv-import', 'pdf-import')
       AND bio IS NULL AND previous_companies IS NULL
       ORDER BY created_at DESC LIMIT 50`
    ).all(userId);
  }

  if (founders.length === 0) {
    return res.json({ enriched: 0, failed: 0, message: 'No founders with LinkedIn URLs to enrich' });
  }

  // Respond immediately, enrich in background
  res.json({ started: true, total: founders.length, message: `Enriching ${founders.length} profiles...` });

  // Background enrichment
  const updateFounder = db.prepare(`
    UPDATE founders SET
      bio = COALESCE(?, bio),
      previous_companies = COALESCE(?, previous_companies),
      notable_background = COALESCE(?, notable_background),
      location_city = COALESCE(?, location_city),
      location_state = COALESCE(?, location_state),
      role = COALESCE(?, role),
      updated_at = CURRENT_TIMESTAMP
    WHERE id = ? AND created_by = ?
  `);

  for (const f of founders) {
    try {
      const data = await enrichWithLinkedIn(f.linkedin_url, apiKey);
      if (data) {
        const bio = data.summary || data.headline || null;
        const experience = data.experience?.map(e => `${e.title} at ${e.company}`).slice(0, 5).join('; ') || null;
        const education = data.education?.map(e => `${e.school} (${e.degree || ''})`).slice(0, 3).join('; ') || null;
        const city = data.city || data.location?.split(',')[0] || null;
        const state = data.state || data.location?.split(',')[1]?.trim() || null;
        const role = data.headline || null;

        updateFounder.run(bio, experience, education, city, state, role, f.id, userId);
      }
      // Rate limit
      await new Promise(r => setTimeout(r, 800));
    } catch (err) {
      console.error(`[Import] Enrich failed for founder ${f.id}:`, err.message);
    }
  }
  console.log(`[Import] Enrichment complete for ${founders.length} founders`);
});

module.exports = router;
