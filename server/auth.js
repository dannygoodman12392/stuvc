const jwt = require('jsonwebtoken');
const bcrypt = require('bcryptjs');
const db = require('./db');

const JWT_SECRET = process.env.JWT_SECRET || 'superior-os-dev-secret-change-me';

function hashPassword(password) {
  return bcrypt.hashSync(password, 10);
}

function verifyPassword(password, hash) {
  return bcrypt.compareSync(password, hash);
}

function generateToken(user) {
  return jwt.sign(
    { id: user.id, email: user.email, name: user.name, role: user.role },
    JWT_SECRET,
    { expiresIn: '7d' }
  );
}

function requireAuth(req, res, next) {
  const header = req.headers.authorization;
  if (!header || !header.startsWith('Bearer ')) {
    return res.status(401).json({ error: 'Authentication required' });
  }
  try {
    const token = header.split(' ')[1];
    const decoded = jwt.verify(token, JWT_SECRET);
    req.user = decoded;
    next();
  } catch {
    return res.status(401).json({ error: 'Invalid or expired token' });
  }
}

// Seed the team if no users exist. Normally a no-op now — db.js already ensures the
// owner (user_id=1) exists at init so the user_id=1 seeds don't FK-crash on a fresh DB.
// Kept as a safety net; uses the same env-overridable default password.
function seedTeam() {
  const count = db.prepare('SELECT COUNT(*) as c FROM users').get().c;
  if (count === 0) {
    const pw = process.env.SEED_ADMIN_PASSWORD || 'Murphy1!';
    const insert = db.prepare('INSERT INTO users (email, name, role, password_hash) VALUES (?, ?, ?, ?)');
    insert.run('danny.eric.goodman@gmail.com', 'Danny Goodman', 'admin', hashPassword(pw));
    console.log('Seeded admin account');
  }
}

module.exports = { hashPassword, verifyPassword, generateToken, requireAuth, seedTeam };
