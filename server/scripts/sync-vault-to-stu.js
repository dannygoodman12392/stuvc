#!/usr/bin/env node
// ══════════════════════════════════════════════════════════════════════════
// sync-vault-to-stu.js — the vault's curated analysis onto the company cards.
//
// Danny, 2026-07-16: "It would be more helpful to have call notes and memos from
// the vault in obsidian to sync up to Stu."
//
// He's right, and it's the better direction. The vault holds 103,454 words across
// 25 companies — 22 Call Notes, 21 Founder Assessments, 13 Market Deep Dives —
// every one of them already cleaned, structured, rubric-scored and web-researched
// by the nightly workup. Stu cannot see a single word of it.
//
// ── WHY THIS BEATS SYNCING GRANOLA ──
// A raw transcript is 13K chars of "um" and crosstalk. A vault Call Note is the
// same conversation, cleaned, with the fluff gone. For the honesty gate that
// matters in a specific way: a quote pulled from a Call Note is a quote from a
// DOCUMENT DANNY'S ANALYST WROTE, not from the founder's mouth — so this labels
// them by kind and never pretends otherwise.
//
// Both belong on the card. The transcript is the primary source; the vault note is
// the considered read. They're different sources, and the log holds both.
//
// ── DIRECTION ──
// The vault lives on Danny's laptop; Stu runs on Railway. Railway cannot read the
// vault, so this is a PUSH, and it runs where the files are. Locally it writes
// straight to the DB; with --push it goes through the secret-gated endpoint that
// already carries commitments.
//
//   node scripts/sync-vault-to-stu.js            # dry run — show the plan
//   node scripts/sync-vault-to-stu.js --apply    # write to the local DB
//   node scripts/sync-vault-to-stu.js --push --secret=… --host=https://www.stu.vc
// ══════════════════════════════════════════════════════════════════════════

const fs = require('fs');
const path = require('path');
const db = require('../db');
const { recordSource } = require('../lib/signals');

const VAULT = '/Users/dannygoodman/Documents/Claude Workspace/Brain/08 Deals & Memos';
const APPLY = process.argv.includes('--apply');
const PUSH = process.argv.includes('--push');
const OWNER = 1;

// What kind of document is this, and does it belong on a card?
// Market Deep Dives are deliberately EXCLUDED: they're research about a market,
// not evidence about this company, and a signal quoting one would attribute a
// market claim to the founder. Wrong subject.
const KINDS = [
  { re: /call notes/i, kind: 'granola', label: 'Call notes' },
  { re: /founder assessment/i, kind: 'note', label: 'Founder assessment' },
  { re: /deal memo/i, kind: 'note', label: 'Deal memo' },
  { re: /first-pitch brief/i, kind: 'note', label: 'First-pitch brief' },
];

const norm = (s) => String(s || '').toLowerCase().replace(/[^a-z0-9]/g, '');

// Pull the call date out of the note rather than using the file mtime. A note
// written tonight about a call in March must not read as fresh contact — that
// distinction is exactly what lib/attention.js is blocked on.
function occurredAt(text, fallback) {
  const m =
    text.match(/^date:\s*(\d{4}-\d{2}-\d{2})/im) ||
    text.match(/\*\*date\*\*:?\s*(\d{4}-\d{2}-\d{2})/i) ||
    text.match(/\b(20\d{2}-\d{2}-\d{2})\b/);
  return m ? m[1] : fallback;
}

function main() {
  const founders = db
    .prepare('SELECT id, name, company FROM founders WHERE is_deleted = 0 AND created_by = ?')
    .all(OWNER);

  const plan = [];
  const unmatched = [];

  for (const dir of fs.readdirSync(VAULT, { withFileTypes: true }).filter((d) => d.isDirectory())) {
    const company = dir.name;
    const c = norm(company);

    // Company first, person second. A folder named for a person ("Josh Gordon —
    // Medicare Nav") is real in this vault, so both are tried — but a company
    // match is trusted and a name-only match is REPORTED rather than written,
    // because "Tahini" matching a founder called Alley at a company called Sorin
    // is exactly how a note lands on the wrong card.
    let f = founders.find((x) => norm(x.company) && (norm(x.company) === c || norm(x.company).startsWith(c) || c.startsWith(norm(x.company))));
    let via = 'company';
    if (!f) {
      f = founders.find((x) => norm(x.name) && c.includes(norm(x.name)));
      via = 'name';
    }
    if (!f) { unmatched.push(company); continue; }

    const files = walk(path.join(VAULT, company));
    for (const file of files) {
      // ── Never re-ingest Stu's own output. ──
      // `stu-vault-sync` writes Stu's assessments INTO the vault under
      // "<Company>/From Stu/". Syncing those back would close a loop: Stu's own
      // read becomes a "source", the extractor quotes it, the gate verifies the
      // quote against it, and the card renders Stu's opinion as evidence with a
      // receipt. Laundering, in a circle, with every honesty check passing.
      //
      // 8 of the 26 documents in the first dry run were exactly this.
      if (/(^|\/)From Stu(\/|$)/i.test(path.relative(VAULT, file))) continue;

      const base = path.basename(file);
      const k = KINDS.find((x) => x.re.test(base));
      if (!k) continue;
      const text = fs.readFileSync(file, 'utf8').trim();
      if (text.length < 200) continue;
      const stat = fs.statSync(file);
      plan.push({
        founderId: f.id,
        founderCompany: f.company,
        via,
        kind: k.kind,
        title: `${k.label} — ${company}`,
        text,
        occurredAt: occurredAt(text, stat.mtime.toISOString().slice(0, 10)),
        file: path.relative(VAULT, file),
      });
    }
  }

  console.log(`vault: ${plan.length} documents across ${new Set(plan.map((p) => p.founderId)).size} matched companies`);
  if (unmatched.length) console.log(`no card: ${unmatched.join(', ')}`);
  const byName = plan.filter((p) => p.via === 'name');
  if (byName.length) {
    console.log(`\n⚠ matched by PERSON not company — verify before trusting:`);
    for (const p of byName) console.log(`   ${p.file}  ->  ${p.founderCompany}`);
  }

  if (!APPLY && !PUSH) {
    console.log('\n--- dry run. re-run with --apply to write. ---');
    for (const p of plan.slice(0, 12)) {
      console.log(`   ${String(p.founderCompany).padEnd(20)} ${p.kind.padEnd(8)} ${p.occurredAt}  ${String(p.text.length).padStart(6)}ch  ${p.file}`);
    }
    return;
  }

  let created = 0, deduped = 0;
  for (const p of plan) {
    const r = recordSource({
      founderId: p.founderId, kind: p.kind, title: p.title,
      uri: `vault:${p.file}`, contentText: p.text,
      occurredAt: p.occurredAt, addedBy: OWNER,
      meta: { vault_path: p.file, matched_via: p.via },
    });
    if (r.created) created++; else deduped++;
  }
  console.log(`\nAPPLIED — ${created} sources created, ${deduped} already present`);
}

function walk(dir) {
  const out = [];
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) out.push(...walk(p));
    else if (e.name.endsWith('.md')) out.push(p);
  }
  return out;
}

main();
