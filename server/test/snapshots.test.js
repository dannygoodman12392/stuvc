'use strict';
// ══════════════════════════════════════════════════════════════════════════
// The failure this table exists to prevent is silent and permanent: a refetch
// overwriting the only copy of a reading. You cannot backfill history — if this
// is wrong, nobody notices for three years and then the series is a lie.
//
// So the tests are about what must SURVIVE, not what must be stored.
// ══════════════════════════════════════════════════════════════════════════

const test = require('node:test');
const assert = require('node:assert');
const db = require('../db');
const { recordSnapshot, snapshotsFor, deltaFor, stableHash } = require('../lib/snapshots');

function probe(name = 'Snapshot Probe') {
  return db.prepare(
    `INSERT INTO founders (name, company, created_by, is_deleted) VALUES (?, 'Snapshot Co', 1, 0)`
  ).run(name).lastInsertRowid;
}
function cleanup(fid) {
  db.prepare('DELETE FROM company_snapshots WHERE founder_id = ?').run(fid);
  db.prepare('DELETE FROM founders WHERE id = ?').run(fid);
}
const team = (n, at = '2026-07-16T00:00:00Z') => ({
  fetched_at: at, verified_count: n, size_on_linkedin: n + 2,
  people: Array.from({ length: n }, (_, i) => ({ name: `P${i}` })),
});

test('a reading is kept, and a re-read that changed nothing does not add a row', () => {
  const fid = probe();
  const a = recordSnapshot({ founderId: fid, source: 'enrichlayer', blob: team(6) });
  const b = recordSnapshot({ founderId: fid, source: 'enrichlayer', blob: team(6) });
  assert.equal(a.created, true);
  assert.equal(b.created, false, 'unchanged reading must not append');
  assert.equal(snapshotsFor(fid).length, 1);
  cleanup(fid);
});

test('the fetch timestamp alone is not news', () => {
  // The blob carries fetched_at, which changes on every read. Hash it and a
  // nightly job writes a row a night saying "still 6 people" — a series of pure
  // noise that makes the real signal unfindable.
  const fid = probe();
  recordSnapshot({ founderId: fid, source: 'enrichlayer', blob: team(6, '2026-07-16T00:00:00Z') });
  const b = recordSnapshot({ founderId: fid, source: 'enrichlayer', blob: team(6, '2026-07-17T09:30:00Z') });
  assert.equal(b.created, false, 'same team, later clock — not a new reading');
  assert.equal(snapshotsFor(fid).length, 1);
  cleanup(fid);
});

test('THE POINT: a refetch no longer destroys the previous reading', () => {
  const fid = probe();
  recordSnapshot({ founderId: fid, source: 'enrichlayer', blob: team(6) });
  recordSnapshot({ founderId: fid, source: 'enrichlayer', blob: team(9) });
  const s = snapshotsFor(fid, 'enrichlayer');
  assert.equal(s.length, 2);
  assert.deepEqual(s.map((x) => x.headcount), [6, 9], 'both readings survive, oldest first');
  cleanup(fid);
});

test('shrinking back is a real sequence, not a duplicate', () => {
  // 6 -> 7 -> 6. A UNIQUE(content_hash) — the obvious way to write this table —
  // would silently reject the third reading and erase the fact that they LOST
  // someone. Dedupe is against the previous row only, precisely for this.
  const fid = probe();
  recordSnapshot({ founderId: fid, source: 'enrichlayer', blob: team(6) });
  recordSnapshot({ founderId: fid, source: 'enrichlayer', blob: team(7) });
  const back = recordSnapshot({ founderId: fid, source: 'enrichlayer', blob: team(6) });
  assert.equal(back.created, true, 'returning to a previous value is still news');
  assert.deepEqual(snapshotsFor(fid, 'enrichlayer').map((x) => x.headcount), [6, 7, 6]);
  cleanup(fid);
});

test('headcount tracks verified_count, not the company page’s claim', () => {
  // size_on_linkedin is self-reported; verified_count is people whose own profile
  // names the employer. Both are "true"; only one can't be inflated by the founder.
  const fid = probe();
  recordSnapshot({ founderId: fid, source: 'enrichlayer', blob: team(4) });
  assert.equal(snapshotsFor(fid)[0].headcount, 4, 'not 6 (size_on_linkedin)');
  cleanup(fid);
});

test('the two sources keep separate series', () => {
  const fid = probe();
  recordSnapshot({ founderId: fid, source: 'enrichlayer', blob: team(5) });
  recordSnapshot({ founderId: fid, source: 'public_record', blob: {
    fetched_at: 'x',
    funding: { found: true, latest: { amount_sold: 101000 } },
    hiring: { found: true, role_count: 3 },
  } });
  assert.equal(snapshotsFor(fid, 'enrichlayer').length, 1);
  const pr = snapshotsFor(fid, 'public_record');
  assert.equal(pr.length, 1);
  assert.equal(pr[0].amount_sold, 101000);
  assert.equal(pr[0].role_count, 3);
  cleanup(fid);
});

test('an honest-unknown public record records nulls, not zeros', () => {
  // hiring.found:false means WE DON'T KNOW. Storing role_count 0 would turn an
  // unknown into the claim "they have no open roles" — the exact lie lib/hiring.js
  // refuses to tell.
  const fid = probe();
  recordSnapshot({ founderId: fid, source: 'public_record', blob: {
    funding: { found: false, reason: 'no Form D filer' },
    hiring: { found: false, reason: 'no job board found' },
  } });
  const s = snapshotsFor(fid, 'public_record')[0];
  assert.equal(s.role_count, null);
  assert.equal(s.amount_sold, null);
  cleanup(fid);
});

// ─────────────────────── the derivative ───────────────────────

test('"how are they doing" refuses to answer off one reading', () => {
  const fid = probe();
  recordSnapshot({ founderId: fid, source: 'enrichlayer', blob: team(6) });
  const d = deltaFor(fid);
  assert.equal(d.has, false);
  assert.match(d.reason, /needs two/, 'one point is a fact, not a trend');
  cleanup(fid);
});

test('never read is distinguishable from read once', () => {
  const fid = probe();
  assert.match(deltaFor(fid).reason, /never read/);
  cleanup(fid);
});

test('two readings make the delta Danny asked for on day one', () => {
  const fid = probe();
  recordSnapshot({ founderId: fid, source: 'enrichlayer', blob: team(6) });
  db.prepare(`UPDATE company_snapshots SET taken_at = '2026-05-16T00:00:00Z' WHERE founder_id = ?`).run(fid);
  recordSnapshot({ founderId: fid, source: 'enrichlayer', blob: team(9) });
  db.prepare(`UPDATE company_snapshots SET taken_at = '2026-07-16T00:00:00Z' WHERE founder_id = ? AND headcount = 9`).run(fid);

  const d = deltaFor(fid);
  assert.equal(d.has, true);
  assert.equal(d.from, 6);
  assert.equal(d.to, 9);
  assert.equal(d.delta, 3);
  assert.equal(d.days, 61, '"they were 6 when you met them, they are 9 now, over two months"');
  cleanup(fid);
});

test('stableHash ignores key order but not values', () => {
  assert.equal(stableHash({ a: 1, b: 2 }), stableHash({ b: 2, a: 1 }));
  assert.notEqual(stableHash({ a: 1 }), stableHash({ a: 2 }));
});

test('a bad source is a programming error, not a silent no-op', () => {
  const fid = probe();
  assert.throws(() => recordSnapshot({ founderId: fid, source: 'crunchbase', blob: {} }), /source must be one of/);
  cleanup(fid);
});
