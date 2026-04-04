const express = require('express');
const router = express.Router();
const db = require('../db');

// GET /api/founders/:founderId/files
router.get('/:founderId', (req, res) => {
  const files = db.prepare(`
    SELECT f.*, u.name as uploaded_by
    FROM founder_files f
    LEFT JOIN users u ON f.created_by = u.id
    WHERE f.founder_id = ?
    ORDER BY f.created_at DESC
  `).all(req.params.founderId);
  res.json(files);
});

// POST /api/founders/:founderId/files
router.post('/:founderId', (req, res) => {
  const { file_name, file_type, content_text, url } = req.body;
  if (!file_name) return res.status(400).json({ error: 'File name required' });

  const founder = db.prepare('SELECT id FROM founders WHERE id = ? AND is_deleted = 0').get(req.params.founderId);
  if (!founder) return res.status(404).json({ error: 'Founder not found' });

  const result = db.prepare(
    'INSERT INTO founder_files (founder_id, file_name, file_type, content_text, url, created_by) VALUES (?, ?, ?, ?, ?, ?)'
  ).run(req.params.founderId, file_name, file_type || null, content_text || null, url || null, req.user.id);

  const file = db.prepare('SELECT * FROM founder_files WHERE id = ?').get(result.lastInsertRowid);
  res.status(201).json(file);
});

// DELETE /api/founders/:founderId/files/:id
router.delete('/:founderId/:id', (req, res) => {
  const file = db.prepare('SELECT * FROM founder_files WHERE id = ? AND founder_id = ?').get(req.params.id, req.params.founderId);
  if (!file) return res.status(404).json({ error: 'File not found' });
  db.prepare('DELETE FROM founder_files WHERE id = ?').run(req.params.id);
  res.json({ message: 'File deleted' });
});

module.exports = router;
