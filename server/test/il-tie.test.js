const test = require('node:test');
const assert = require('node:assert');
const { verifyIlTie, profileText, stripFalseGeo } = require('../lib/ilTie');

// ══════════════════════════════════════════════════════════════════════════
// The Illinois tie gate.
//
// Danny: "Tie to Illinois is important to me. Either they're from Chicago or
// Illinois, worked here for some time, went to school here in some way, etc."
//
// Geography is the fund's moat, so this gate decides what is allowed on the
// board. Every REJECT case below is a real row that was sitting in the inbox on
// 2026-07-15 wearing a verified Chicago tie.
// ══════════════════════════════════════════════════════════════════════════

// ── The regression that caused this file ──
// 55 of 85 "IL-tied" inbox rows were national-elite alumni, because the tie was
// read out of a user setting that merged 12 Illinois schools with 36 national
// ones. Pedigree is not a location.
test('national elite schools NEVER establish an Illinois tie', () => {
  const schools = [
    'Stanford', 'Stanford University', 'Harvard', 'Harvard Business School',
    'MIT', 'Massachusetts Institute of Technology', 'Yale', 'Yale University',
    'Carnegie Mellon', 'CMU', 'Wharton', 'UPenn', 'Princeton', 'Cornell',
    'Georgia Tech', 'UC Berkeley', 'Caltech', 'Duke', 'Brown University',
    'University of Michigan', 'NYU', 'USC', 'UCLA', 'University of Waterloo',
  ];
  for (const s of schools) {
    const r = verifyIlTie(`Founder at Amulet (YC S26). ${s} alum. Formerly SWE at Meta.`);
    assert.equal(r.verified, false, `${s} must not establish an Illinois tie`);
  }
});

// The exact row that exposed the bug.
test('the Nithik Bala row — Georgia Tech, YC, Meta — is rejected', () => {
  const r = verifyIlTie(
    'Founder at Amulet (YC S26). Formerly SWE at Meta on Core Ads Growth & Web Infra. ' +
      'Previously interned at Rockset (acquired by OpenAI) and PagerDuty (S10). Georgia Tech alum.'
  );
  assert.equal(r.verified, false);
});

// ── IIT. The trap with the widest blast radius. ──
// "iit" was in the old Illinois school list, and the YC directory is full of
// Indian Institute of Technology graduates.
test('IIT means Indian Institutes of Technology, not Illinois Tech', () => {
  for (const s of ['IIT Bombay', 'IIT Delhi', 'IIT Madras', 'IIT Kharagpur', 'Indian Institute of Technology']) {
    const r = verifyIlTie(`Founder. ${s} alum. Based in San Francisco.`);
    assert.equal(r.verified, false, `${s} must not establish an Illinois tie`);
    assert.match(r.reason, /not Illinois/i);
  }
});

test('Illinois Institute of Technology, spelled out, IS a tie', () => {
  const r = verifyIlTie('Founder. Illinois Institute of Technology, class of 2019.');
  assert.equal(r.verified, true);
  assert.equal(r.type, 'school');
});

// An IIT Bombay grad who lives in Chicago has a real tie. The trap must not
// swallow the whole profile.
test('an IIT Bombay grad living in Chicago still has a tie', () => {
  const r = verifyIlTie('Founder. IIT Bombay alum. Based in Chicago, IL.');
  assert.equal(r.verified, true);
  assert.equal(r.type, 'current');
});

// ── The other name traps ──
test('Northwestern Mutual (Milwaukee) is not Northwestern University', () => {
  const r = verifyIlTie('Financial advisor at Northwestern Mutual. Based in Milwaukee, WI.');
  assert.equal(r.verified, false);
});

test('Northwestern University IS a tie', () => {
  const r = verifyIlTie('Founder. Northwestern University, McCormick School of Engineering.');
  assert.equal(r.verified, true);
  assert.equal(r.type, 'school');
});

test('Loyola Marymount (LA) is not Loyola Chicago', () => {
  const r = verifyIlTie('Founder. Loyola Marymount University alum. Based in Los Angeles.');
  assert.equal(r.verified, false);
});

test('Columbia University (NY) is not Columbia College Chicago', () => {
  const r = verifyIlTie('Founder. Columbia University alum. Based in New York.');
  assert.equal(r.verified, false);
});

// ── False geography: naming Chicago without being there ──
test('Chicago sports allegiance is not a tie', () => {
  for (const s of ['Chicago Bears superfan', 'Die-hard Chicago Cubs fan', 'Chicago Bulls season ticket holder']) {
    const r = verifyIlTie(`Founder in San Francisco. ${s}.`);
    assert.equal(r.verified, false, `"${s}" must not establish a tie`);
  }
});

test('Chicago-style pizza is not a tie', () => {
  const r = verifyIlTie('Founder in Brooklyn. Obsessed with Chicago-style deep dish pizza.');
  assert.equal(r.verified, false);
});

// ── The four real tie types, in Danny's own words ──
test('current — lives in Illinois', () => {
  for (const s of ['Based in Chicago, IL', 'Living in Evanston, Illinois', 'Based out of the West Loop', 'Greater Chicago area']) {
    const r = verifyIlTie(`Founder. ${s}.`);
    assert.equal(r.verified, true, `"${s}" should be a tie`);
    assert.equal(r.type, 'current');
  }
});

test('worked — a job held in Illinois', () => {
  const r = verifyIlTie('Software engineer at a startup in Chicago for four years.');
  assert.equal(r.verified, true);
  assert.equal(r.type, 'worked');
});

test('worked — a Chicago-anchored employer counts as time here', () => {
  for (const co of ['Citadel', 'DRW', 'Groupon', 'Grubhub', 'Tempus', 'Morningstar', 'Project44']) {
    const r = verifyIlTie(`Founder. Previously an engineer at ${co}. Now based in Austin.`);
    assert.equal(r.verified, true, `${co} should establish a worked tie`);
    assert.equal(r.type, 'worked');
  }
});

test('school — went to school here in some way', () => {
  for (const s of ['UIUC', 'University of Chicago', 'Chicago Booth', 'DePaul University', 'Southern Illinois University', 'Argonne']) {
    const r = verifyIlTie(`Founder. ${s} alum. Based in Seattle.`);
    assert.equal(r.verified, true, `${s} should establish a school tie`);
    assert.equal(r.type, 'school');
  }
});

test('hometown — from Illinois', () => {
  for (const s of ['Grew up in Naperville', 'Born in Chicago', 'Rockford native', 'Raised in Evanston']) {
    const r = verifyIlTie(`Founder in NYC. ${s}.`);
    assert.equal(r.verified, true, `"${s}" should establish a hometown tie`);
    assert.equal(r.type, 'hometown');
  }
});

// A deliberate false NEGATIVE, recorded so it doesn't get "fixed" by accident.
// "Peoria native" was in the test above until Peoria moved to the ambiguous list.
// Peoria, Arizona is real, so an unqualified mention isn't evidence of Illinois.
// This file's rule is that false positives are the enemy: a missed founder costs
// one name, a board that lies costs the board. He shows up qualified, or via a
// co-founder, or not at all.
test('an unqualified ambiguous hometown is REJECTED, on purpose', () => {
  assert.equal(verifyIlTie('Founder in NYC. Peoria native.').verified, false);
  assert.equal(verifyIlTie('Founder in NYC. Peoria, IL native.').verified, true);
});

// ── Presence beats pedigree ──
// A Stanford grad who lives in Chicago is a Chicago founder. The gate rejects the
// school as a tie but must still find the address.
test('a Stanford grad based in Chicago has a CURRENT tie', () => {
  const r = verifyIlTie('Founder. Stanford CS. Based in Chicago, IL.');
  assert.equal(r.verified, true);
  assert.equal(r.type, 'current');
  assert.match(r.place, /Chicago/i);
});

// ── Evidence ──
// The 55 bad rows were invisible because nobody could read WHY they were tied.
test('every verified tie carries readable evidence and the matched phrase', () => {
  const r = verifyIlTie('Founder and CEO. Northwestern University, 2018. Now building in Denver.');
  assert.equal(r.verified, true);
  assert.ok(r.evidence && r.evidence.length > 0, 'must carry evidence');
  assert.ok(r.matched && /northwestern/i.test(r.matched), 'must name what matched');
});

test('a rejection explains itself', () => {
  const r = verifyIlTie('Founder. Stanford alum. Based in San Francisco.');
  assert.equal(r.verified, false);
  assert.ok(r.reason && r.reason.length > 0);
});

// ── The self-verification loop ──
// profileText must never read chicago_connection, or a bad tie written by a
// previous run re-verifies itself on every re-partition, forever.
test('profileText does NOT read chicago_connection back in', () => {
  const t = profileText({
    name: 'Test',
    headline: 'Founder in San Francisco',
    chicago_connection: 'school_alumni: Stanford',
  });
  assert.ok(!/stanford/i.test(t), 'chicago_connection must not feed the verifier');
  const r = verifyIlTie(t);
  assert.equal(r.verified, false);
});

// ── Word boundaries ──
test('substrings do not match', () => {
  // "normal" is an Illinois city; "normally" is not a tie.
  const r = verifyIlTie('Founder. Normally ships on Fridays. Based in Portland.');
  assert.equal(r.verified, false);
});

// ── Place names that are also ordinary words ──
// Every case below is real. The first one is a row this gate itself produced on
// 2026-07-15, the first time the a16z Speedrun connector ever ran:
//   Benjamin Lee — Vega — New York — "cto @ vega / BEING SO NORMAL"
//     -> verified: true, type: 'worked', place: 'Normal'
// Normal, Illinois is a real city. \bnormal\b matched inside "BEING SO NORMAL".
// A word-boundary match is not enough when the place name IS a word.
test('an ambiguous place name never establishes a tie unqualified', () => {
  const cases = [
    'cto @ vega / BEING SO NORMAL',                        // Normal, IL
    'Building the aurora of a new category. Based in SF.', // Aurora, IL
    'Quoting Cicero at every standup. Brooklyn.',          // Cicero, IL
    'Aurora Chen, founder, based in Denver',               // a person's name
    'Founder in Decatur, GA',                              // Decatur, IL
    'Founder in Bloomington, Indiana',                     // Bloomington, IL
    'Founder in Springfield, Missouri',                    // Springfield, IL
    'Founder in Peoria, Arizona',                          // Peoria, IL
    'We keep our burn normal and our team small. Austin.',
  ];
  for (const c of cases) {
    const r = verifyIlTie(`Founder. ${c}`);
    assert.equal(r.verified, false, `"${c}" must not establish an Illinois tie (got ${r.type}: ${r.place})`);
  }
});

test('an ambiguous place name DOES count when qualified as Illinois', () => {
  for (const c of ['Normal, IL', 'Normal, Illinois', 'Aurora, IL', 'Decatur, Illinois', 'Springfield, IL', 'Peoria, IL']) {
    const r = verifyIlTie(`Founder based in ${c}.`);
    assert.equal(r.verified, true, `"${c}" should be a tie`);
  }
});

test('empty or junk input is rejected, not crashed on', () => {
  for (const v of [null, undefined, '', '   ']) {
    const r = verifyIlTie(v);
    assert.equal(r.verified, false);
  }
});

test('stripFalseGeo reports what it removed', () => {
  const { text, stripped } = stripFalseGeo('Chicago Bears fan living in Austin');
  assert.ok(stripped.length > 0);
  assert.ok(!/bears/i.test(text));
});

// ── Co-founder ties ──
// A company is Illinois-tied if a founder is (Perspectives Health's CTO must not
// be dropped for a terse bio) — but a derived tie must never look like a direct
// one, because laundering one co-founder's tie onto another is the original bug.
const { propagateCofounderTies, companyKey } = require('../lib/ilTie');
const V = (rows) => propagateCofounderTies(rows, (r) => verifyIlTie(profileText(r)));

test('a co-founder tie is lent to the untied co-founder, and labelled', () => {
  const rows = [
    { id: 1, name: 'Eshan Dosani', company: 'Perspectives Health', headline: 'CEO/Co-founder UChicago, Perspectives Health' },
    { id: 2, name: 'Kyle Jung', company: 'Perspectives Health', headline: 'CTO, Perspectives Health (YC Summer 2025)' },
  ];
  const out = V(rows);
  assert.equal(out.get(1).type, 'school');
  assert.equal(out.get(1).derived, undefined, 'the anchor keeps a DIRECT tie');

  const lent = out.get(2);
  assert.equal(lent.verified, true);
  assert.equal(lent.type, 'cofounder');
  assert.equal(lent.derived, true, 'a lent tie must be marked derived');
  assert.equal(lent.via, 'Eshan Dosani');
  assert.match(lent.evidence, /via co-founder Eshan Dosani/i);
});

// The trap that would undo everything: 8 unrelated people share the company name
// "Stealth" in the live inbox. Grouping on it hands one tie to seven strangers.
test('generic company names never group', () => {
  for (const c of ['Stealth', 'stealth mode', 'Unknown', 'N/A', 'TBD', 'Confidential']) {
    assert.equal(companyKey({ company: c }), null, `"${c}" must not be a group key`);
  }
  const rows = [
    { id: 1, name: 'Real Chicagoan', company: 'Stealth', headline: 'Founder based in Chicago, IL' },
    { id: 2, name: 'Unrelated Person', company: 'Stealth', headline: 'Founder in Miami. Stanford alum.' },
  ];
  const out = V(rows);
  assert.equal(out.get(1).verified, true);
  assert.equal(out.get(2).verified, false, 'must not inherit a tie from a stranger at "Stealth"');
});

test('a company with no tied founder lends nothing', () => {
  const rows = [
    { id: 1, name: 'A', company: 'Acme AI', headline: 'Founder. Stanford. San Francisco.' },
    { id: 2, name: 'B', company: 'Acme AI', headline: 'Founder. MIT.' },
  ];
  const out = V(rows);
  assert.equal(out.get(1).verified, false);
  assert.equal(out.get(2).verified, false);
});

test('a derived tie never becomes an anchor for a third person', () => {
  // Otherwise one weak tie chains across a whole company and the evidence trail
  // stops naming a real person.
  const rows = [
    { id: 1, name: 'Anchor', company: 'Chain Co', headline: 'Founder. Northwestern University.' },
    { id: 2, name: 'Lent', company: 'Chain Co', headline: 'Engineer.' },
    { id: 3, name: 'Also Lent', company: 'Chain Co', headline: 'Designer.' },
  ];
  const out = V(rows);
  assert.equal(out.get(2).via, 'Anchor');
  assert.equal(out.get(3).via, 'Anchor', 'both must trace to the real anchor, not to each other');
});

// The place string is what Danny reads on the board. "current: Based IN Chicago"
// looks broken, and evidence that looks broken doesn't get trusted — which is the
// whole asset this gate is trying to rebuild.
test('the place is the city, not the preposition', () => {
  for (const s of ['Based in Chicago, IL', "I'm currently based in Evanston, Illinois", 'Living in Naperville, IL']) {
    const r = verifyIlTie(`Founder. ${s}.`);
    assert.equal(r.verified, true);
    assert.ok(!/^based|^in |^living/i.test(r.place), `place should not start with a preposition, got "${r.place}"`);
    assert.ok(!/\bIN\b/.test(r.place), `"IN" is Indiana's code — never emit it, got "${r.place}"`);
  }
});

test('presence outranks pedigree when picking the anchor', () => {
  const rows = [
    { id: 1, name: 'Schooled', company: 'Pick Co', headline: 'Founder. UIUC alum. Lives in Denver.' },
    { id: 2, name: 'Resident', company: 'Pick Co', headline: 'Founder. Based in Chicago, IL.' },
    { id: 3, name: 'Neither', company: 'Pick Co', headline: 'Engineer.' },
  ];
  const out = V(rows);
  assert.equal(out.get(3).via, 'Resident', 'the current-resident anchor should win over the alum');
  assert.equal(out.get(3).via_type, 'current');
});
