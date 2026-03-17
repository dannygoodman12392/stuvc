/**
 * Auto-seeds the production database on first deploy if it's empty.
 * Reads from seed-data.json.gz (compressed founder + user data).
 */
const fs = require('fs');
const zlib = require('zlib');
const path = require('path');
const db = require('./db');

function seedIfEmpty() {
  const count = db.prepare('SELECT COUNT(*) as c FROM founders').get();
  if (count.c > 0) {
    console.log(`[Seed] Database already has ${count.c} founders, skipping seed.`);
    return;
  }

  const seedPath = path.join(__dirname, 'seed-data.json.gz');
  if (!fs.existsSync(seedPath)) {
    console.log('[Seed] No seed-data.json.gz found, starting fresh.');
    return;
  }

  console.log('[Seed] Empty database detected, importing seed data...');
  const raw = zlib.gunzipSync(fs.readFileSync(seedPath));
  const data = JSON.parse(raw.toString());

  // Import users (skip if they already exist from seedTeam)
  const existingUsers = db.prepare('SELECT COUNT(*) as c FROM users').get();
  if (existingUsers.c === 0 && data.users) {
    const insertUser = db.prepare(`
      INSERT OR IGNORE INTO users (id, email, name, role, password_hash, created_at, last_login)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `);
    for (const u of data.users) {
      insertUser.run(u.id, u.email, u.name, u.role, u.password_hash, u.created_at, u.last_login);
    }
    console.log(`[Seed] Imported ${data.users.length} users`);
  }

  // Import founders
  if (data.founders && data.founders.length > 0) {
    // Get all column names from the first founder
    const cols = Object.keys(data.founders[0]);
    const placeholders = cols.map(() => '?').join(', ');
    const insertFounder = db.prepare(`INSERT INTO founders (${cols.join(', ')}) VALUES (${placeholders})`);

    const insertMany = db.transaction((founders) => {
      for (const f of founders) {
        insertFounder.run(...cols.map(c => f[c]));
      }
    });

    insertMany(data.founders);
    console.log(`[Seed] Imported ${data.founders.length} founders`);
  }

  console.log('[Seed] Database seeded successfully!');
}

module.exports = { seedIfEmpty };
