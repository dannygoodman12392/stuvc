const express = require('express');
const router = express.Router();
const db = require('../db');

// GET /api/deal-room
router.get('/', (req, res) => {
  const deals = db.prepare(`
    SELECT d.*, f.name as founder_name, f.company as founder_company, a.overall_signal
    FROM deal_room d
    LEFT JOIN founders f ON d.founder_id = f.id
    LEFT JOIN opportunity_assessments a ON d.assessment_id = a.id
    WHERE f.created_by = ?
    ORDER BY d.created_at DESC
  `).all(req.user.id);
  res.json(deals);
});

// GET /api/deal-room/:id
router.get('/:id', (req, res) => {
  const deal = db.prepare(`
    SELECT d.*, f.name as founder_name, f.company as founder_company
    FROM deal_room d
    LEFT JOIN founders f ON d.founder_id = f.id
    WHERE d.id = ? AND f.created_by = ?
  `).get(req.params.id, req.user.id);
  if (!deal) return res.status(404).json({ error: 'Deal not found' });
  res.json(deal);
});

// POST /api/deal-room
router.post('/', (req, res) => {
  const { founder_id, assessment_id } = req.body;
  if (!founder_id) return res.status(400).json({ error: 'Founder ID required' });

  const founder = db.prepare('SELECT id FROM founders WHERE id = ? AND created_by = ? AND is_deleted = 0').get(founder_id, req.user.id);
  if (!founder) return res.status(404).json({ error: 'Founder not found' });

  const result = db.prepare('INSERT INTO deal_room (founder_id, assessment_id, created_by) VALUES (?, ?, ?)').run(founder_id, assessment_id || null, req.user.id);
  const deal = db.prepare('SELECT * FROM deal_room WHERE id = ?').get(result.lastInsertRowid);
  res.status(201).json(deal);
});

// PUT /api/deal-room/:id
router.put('/:id', (req, res) => {
  const deal = db.prepare('SELECT d.* FROM deal_room d JOIN founders f ON d.founder_id = f.id WHERE d.id = ? AND f.created_by = ?').get(req.params.id, req.user.id);
  if (!deal) return res.status(404).json({ error: 'Deal not found' });

  const fields = ['ic_memo', 'round_terms', 'returns_model', 'decision', 'decision_rationale', 'decision_date'];
  const updates = [];
  const params = [];

  for (const field of fields) {
    if (req.body[field] !== undefined) {
      updates.push(`${field} = ?`);
      params.push(req.body[field]);
    }
  }

  if (updates.length === 0) return res.status(400).json({ error: 'No fields to update' });
  updates.push('updated_at = CURRENT_TIMESTAMP');
  params.push(req.params.id);

  db.prepare(`UPDATE deal_room SET ${updates.join(', ')} WHERE id = ?`).run(...params);
  const updated = db.prepare('SELECT * FROM deal_room WHERE id = ?').get(req.params.id);
  res.json(updated);
});

module.exports = router;
