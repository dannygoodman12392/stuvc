const express = require('express');
const router = express.Router();
const db = require('../db');

// GET /api/notes/:founderId
router.get('/:founderId', (req, res) => {
  const notes = db.prepare('SELECT n.*, u.name as author FROM founder_notes n LEFT JOIN users u ON n.created_by = u.id WHERE n.founder_id = ? ORDER BY n.created_at DESC').all(req.params.founderId);
  res.json(notes);
});

// POST /api/notes/:founderId
router.post('/:founderId', (req, res) => {
  const { content } = req.body;
  if (!content) return res.status(400).json({ error: 'Content required' });

  const founder = db.prepare('SELECT id FROM founders WHERE id = ? AND is_deleted = 0').get(req.params.founderId);
  if (!founder) return res.status(404).json({ error: 'Founder not found' });

  const result = db.prepare('INSERT INTO founder_notes (founder_id, content, created_by) VALUES (?, ?, ?)').run(req.params.founderId, content, req.user.id);
  db.prepare('UPDATE founders SET updated_at = CURRENT_TIMESTAMP WHERE id = ?').run(req.params.founderId);

  const note = db.prepare('SELECT n.*, u.name as author FROM founder_notes n LEFT JOIN users u ON n.created_by = u.id WHERE n.id = ?').get(result.lastInsertRowid);
  res.status(201).json(note);
});

// PUT /api/notes/:noteId
router.put('/:noteId', (req, res) => {
  const { content } = req.body;
  if (!content) return res.status(400).json({ error: 'Content required' });

  const note = db.prepare('SELECT * FROM founder_notes WHERE id = ?').get(req.params.noteId);
  if (!note) return res.status(404).json({ error: 'Note not found' });

  db.prepare('UPDATE founder_notes SET content = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?').run(content, req.params.noteId);
  const updated = db.prepare('SELECT n.*, u.name as author FROM founder_notes n LEFT JOIN users u ON n.created_by = u.id WHERE n.id = ?').get(req.params.noteId);
  res.json(updated);
});

// DELETE /api/notes/:noteId
router.delete('/:noteId', (req, res) => {
  const note = db.prepare('SELECT * FROM founder_notes WHERE id = ?').get(req.params.noteId);
  if (!note) return res.status(404).json({ error: 'Note not found' });

  db.prepare('DELETE FROM founder_notes WHERE id = ?').run(req.params.noteId);
  res.json({ message: 'Note deleted' });
});

module.exports = router;
