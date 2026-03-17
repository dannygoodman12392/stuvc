const express = require('express');
const router = express.Router();
const db = require('../db');
const { verifyPassword, generateToken, hashPassword, requireAuth } = require('../auth');

// POST /api/auth/login
router.post('/login', (req, res) => {
  const { email, password } = req.body;
  if (!email || !password) return res.status(400).json({ error: 'Email and password required' });

  const user = db.prepare('SELECT * FROM users WHERE email = ?').get(email.toLowerCase().trim());
  if (!user) return res.status(401).json({ error: 'Invalid credentials' });
  if (!verifyPassword(password, user.password_hash)) return res.status(401).json({ error: 'Invalid credentials' });

  db.prepare('UPDATE users SET last_login = CURRENT_TIMESTAMP WHERE id = ?').run(user.id);
  const token = generateToken(user);

  res.json({
    token,
    user: { id: user.id, email: user.email, name: user.name, role: user.role }
  });
});

// GET /api/auth/me
router.get('/me', requireAuth, (req, res) => {
  const user = db.prepare('SELECT id, email, name, role, created_at, last_login FROM users WHERE id = ?').get(req.user.id);
  if (!user) return res.status(404).json({ error: 'User not found' });
  res.json(user);
});

// PUT /api/auth/password
router.put('/password', requireAuth, (req, res) => {
  const { currentPassword, newPassword } = req.body;
  if (!currentPassword || !newPassword) return res.status(400).json({ error: 'Both passwords required' });
  if (newPassword.length < 8) return res.status(400).json({ error: 'Password must be at least 8 characters' });

  const user = db.prepare('SELECT * FROM users WHERE id = ?').get(req.user.id);
  if (!verifyPassword(currentPassword, user.password_hash)) return res.status(401).json({ error: 'Current password incorrect' });

  db.prepare('UPDATE users SET password_hash = ? WHERE id = ?').run(hashPassword(newPassword), req.user.id);
  res.json({ message: 'Password updated' });
});

// POST /api/auth/invite (admin only)
router.post('/invite', requireAuth, (req, res) => {
  if (req.user.role !== 'admin') return res.status(403).json({ error: 'Admin access required' });

  const { email, name, role } = req.body;
  if (!email || !name) return res.status(400).json({ error: 'Email and name required' });

  const existing = db.prepare('SELECT id FROM users WHERE email = ?').get(email.toLowerCase().trim());
  if (existing) return res.status(409).json({ error: 'User already exists' });

  const tempPassword = 'superior' + Math.random().toString(36).slice(2, 8);
  const result = db.prepare('INSERT INTO users (email, name, role, password_hash) VALUES (?, ?, ?, ?)').run(
    email.toLowerCase().trim(), name, role || 'member', hashPassword(tempPassword)
  );

  res.json({ id: result.lastInsertRowid, email, name, tempPassword });
});

// GET /api/auth/team
router.get('/team', requireAuth, (req, res) => {
  const team = db.prepare('SELECT id, email, name, role, created_at, last_login FROM users ORDER BY name').all();
  res.json(team);
});

module.exports = router;
