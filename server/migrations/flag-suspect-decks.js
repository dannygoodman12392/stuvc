/**
 * flag-suspect-decks
 * ==================
 * Historical deck-based assessments were created when the client read PDFs as text,
 * corrupting them — and the original files were never stored, so they CANNOT be
 * re-extracted. The honest remedy: detect those assessments and flag them 'suspect'
 * so their scores are visibly not-trustworthy and you can re-upload the PDF.
 *
 * Also flags assessments whose only deck was an un-ingested DocSend/Slides link.
 */
const db = require('../db');
const { deckContentIntegrity } = require('../agents/deck-ingest');

function run() {
  const assessments = db.prepare("SELECT id FROM opportunity_assessments WHERE is_deleted = 0").all();
  const deckInputs = db.prepare("SELECT assessment_id, label, content FROM assessment_inputs WHERE input_type = 'deck'");
  const setFlag = db.prepare('UPDATE opportunity_assessments SET deck_status = ?, deck_status_reason = ? WHERE id = ?');

  const byAssessment = {};
  for (const row of deckInputs.all()) {
    (byAssessment[row.assessment_id] ||= []).push(row);
  }

  let suspect = 0, ok = 0;
  const suspectList = [];
  const tx = db.transaction(() => {
    for (const a of assessments) {
      const decks = byAssessment[a.id] || [];
      if (decks.length === 0) { continue; } // no deck — not a deck-based assessment
      const verdicts = decks.map(d => deckContentIntegrity(d.content));
      const bad = verdicts.filter(v => v.status === 'corrupted' || v.status === 'link' || v.status === 'not_ingested' || v.status === 'empty');
      const anyGood = verdicts.some(v => v.status === 'ok');
      if (bad.length > 0 && !anyGood) {
        const reason = `${bad.length}/${decks.length} deck(s) not usable: ${[...new Set(bad.map(b => b.status + (b.reason ? ` (${b.reason})` : '')))].join(', ')}`;
        setFlag.run('suspect', reason, a.id);
        suspect++;
        suspectList.push({ assessment_id: a.id, reason });
      } else {
        setFlag.run('ok', null, a.id);
        ok++;
      }
    }
  });
  tx();

  console.log(`[flag-suspect-decks] flagged ${suspect} assessments as deck-suspect, ${ok} ok.`);
  if (suspectList.length) {
    console.log('[flag-suspect-decks] SUSPECT assessment ids:', suspectList.slice(0, 50).map(s => s.assessment_id).join(', '));
  }
  return { suspect, ok, suspectList };
}

module.exports = run;
