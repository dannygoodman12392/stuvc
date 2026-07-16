// ══════════════════════════════════════════════════════════════════════════
// backup.js — the thing that did not exist.
//
// A cold architecture review asked one question — "would you be comfortable
// owning this on-call?" — and answered no, for one reason: there were no backups.
// None. I grepped the whole repo for `backup`, `.backup(`, `VACUUM INTO`,
// `litestream`: zero hits in any server code, Dockerfile or railway.json.
//
// The recovery story was `seed-data.json.gz`, dated 2026-03-16, containing 5,084
// founders and one user. Four months stale, founders only. Every assessment,
// note, call log, memo, signal, sourced founder and commitment would be gone
// permanently — including the conviction scores, the decisions, and the
// commitment ledger, which are the only things in here that can't be re-derived.
//
// And the seed makes the loss INVISIBLE: seedIfEmpty() refills the founder count
// on an empty DB, so the one number you'd check reports healthy while the product
// is empty. See db.js for the full trap.
//
// ── WHY better-sqlite3's .backup() AND NOT `cp` ──
// The DB is in WAL mode with a 4MB -wal file. `cp superior-os.db` copies the main
// file and NOT the WAL, so the copy silently loses every write since the last
// checkpoint — a backup that restores stale data and says nothing. .backup() is
// the online backup API: it reads through the WAL, holds a consistent snapshot,
// and does not block writers.
//
// ── AN UNRESTORED BACKUP IS A RUMOUR ──
// So every backup is VERIFIED by opening it and counting the canary table. A file
// that exists proves nothing; a file that opens and holds the assessments proves
// something. If the verify fails the backup is deleted rather than kept, because
// a corrupt backup you trust is worse than no backup you know you lack.
// ══════════════════════════════════════════════════════════════════════════

const fs = require('fs');
const path = require('path');
const zlib = require('zlib');
const Database = require('better-sqlite3');
const db = require('../db');

// Alongside the DB, so it lands on the same persistent volume in production.
// Local dev writes next to the dev DB, which is fine and also useful.
const DB_PATH = process.env.DATABASE_PATH || path.join(__dirname, '..', 'superior-os.db');
const BACKUP_DIR = process.env.BACKUP_DIR || path.join(path.dirname(DB_PATH), 'backups');
const KEEP = Number(process.env.BACKUP_KEEP || 14);

// The canary. Founders are re-seeded on an empty DB and therefore prove nothing;
// assessments never are. If a "backup" has fewer of these than the live DB, it is
// not a backup of this database.
function canaryCount(handle) {
  try {
    return handle.prepare('SELECT COUNT(*) n FROM opportunity_assessments').get().n;
  } catch {
    return -1; // table missing → not our schema → not a valid backup
  }
}

/**
 * Take one verified, compressed snapshot. Never throws — a failed backup must not
 * take the server down — but ALWAYS reports, because a backup that fails silently
 * is the same disease as the run log that reported success while doing nothing.
 */
async function runBackup({ keep = KEEP } = {}) {
  const started = Date.now();
  fs.mkdirSync(BACKUP_DIR, { recursive: true });

  const stamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
  const raw = path.join(BACKUP_DIR, `stu-${stamp}.db`);
  const gz = `${raw}.gz`;

  const live = canaryCount(db);

  try {
    // Online backup — reads through the WAL, doesn't block writers.
    await db.backup(raw);
  } catch (e) {
    return { ok: false, error: `backup failed: ${e.message}` };
  }

  // ── VERIFY. Open it and count the canary. ──
  let restored = -1;
  try {
    const h = new Database(raw, { readonly: true });
    restored = canaryCount(h);
    h.close();
  } catch (e) {
    fs.unlinkSync(raw);
    return { ok: false, error: `backup unreadable, deleted: ${e.message}` };
  }

  if (restored < live) {
    // Fewer assessments than live = the snapshot is not what it claims. Delete it
    // rather than keep a file that would restore a lie.
    fs.unlinkSync(raw);
    return { ok: false, error: `verify FAILED — live has ${live} assessments, backup has ${restored}. Deleted.` };
  }

  // Compress. ~7.5MB → ~1.5MB, and it's cold storage.
  try {
    fs.writeFileSync(gz, zlib.gzipSync(fs.readFileSync(raw), { level: 9 }));
    fs.unlinkSync(raw);
  } catch (e) {
    return { ok: true, file: raw, verified: restored, note: `kept uncompressed: ${e.message}` };
  }

  const pruned = prune(keep);
  return {
    ok: true,
    file: path.basename(gz),
    bytes: fs.statSync(gz).size,
    verified_assessments: restored,
    pruned,
    ms: Date.now() - started,
  };
}

/** Keep the newest `keep` snapshots; delete the rest. */
function prune(keep) {
  const files = fs.readdirSync(BACKUP_DIR)
    .filter((f) => f.startsWith('stu-') && f.endsWith('.gz'))
    .sort()
    .reverse();
  const doomed = files.slice(keep);
  for (const f of doomed) { try { fs.unlinkSync(path.join(BACKUP_DIR, f)); } catch { /* best effort */ } }
  return doomed.length;
}

function listBackups() {
  try {
    return fs.readdirSync(BACKUP_DIR)
      .filter((f) => f.startsWith('stu-') && f.endsWith('.gz'))
      .sort().reverse()
      .map((f) => {
        const s = fs.statSync(path.join(BACKUP_DIR, f));
        return { file: f, bytes: s.size, at: s.mtime.toISOString() };
      });
  } catch { return []; }
}

module.exports = { runBackup, listBackups, prune, BACKUP_DIR };
