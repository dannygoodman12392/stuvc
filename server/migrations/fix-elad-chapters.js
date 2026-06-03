/**
 * fix-elad-chapters
 * =================
 * Originally the Elad Gil source stored ONE row (the whole-book homepage). We now pull
 * individual /book/... chapters. This drops the old whole-book row(s), re-backfills the
 * chapter list for every user that has the Elad source, and clears today's frozen digest
 * so the brief re-picks a real chapter instead of the whole book.
 */
const db = require('../db');

async function run() {
  // 1. Drop any Elad rows that aren't real chapter pages (the old homepage corpus row).
  const del = db.prepare("DELETE FROM brief_archive_posts WHERE archive_key = 'elad' AND url NOT LIKE '%/book/%'");
  const removed = del.run().changes;

  // 2. Re-backfill chapters for each user who has an Elad archive source.
  const { backfillArchive } = require('../services/brief-archive');
  const users = db.prepare("SELECT DISTINCT user_id FROM newsletter_sources WHERE kind='archive' AND archive_key='elad' AND is_deleted=0").all();
  let added = 0;
  for (const { user_id } of users) {
    try { const r = await backfillArchive(user_id, 'elad'); added += (r.added || 0); }
    catch (e) { console.error('[fix-elad-chapters] backfill', user_id, e.message); }
  }

  // 3. Clear today's frozen digest so it rebuilds with a real chapter (one extra rotation
  //    advance across sources is harmless).
  const cleared = db.prepare("DELETE FROM daily_brief WHERE brief_date = date('now','localtime')").run().changes;

  console.log(`[fix-elad-chapters] removed ${removed} whole-book rows, backfilled ${added} chapters across ${users.length} user(s), cleared ${cleared} frozen digest(s)`);
}

module.exports = run;
