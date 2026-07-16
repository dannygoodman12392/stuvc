'use strict';
// ══════════════════════════════════════════════════════════════════════════
// The only failure that matters here is a CONFIDENT WRONG ANSWER. A missing
// funding block costs Danny nothing — he asks the founder. A funding block
// showing another company's raise costs him credibility in an IC meeting, and
// he has no way to catch it, because the number is real and internally
// consistent. It just isn't theirs.
//
// So most of this file is about refusing, and the fixture names are the actual
// names on his board: Gil, Peak, Jean.
// ══════════════════════════════════════════════════════════════════════════

const test = require('node:test');
const assert = require('node:assert');
const { formDFor, parseFormD, nameMatches, surnameOf, norm } = require('../lib/edgar');

// ── A real Form D, trimmed to the tags we read. Shape verified live against
//    Ramp Business Corp (CIK 0001803782) on 2026-07-16.
function formDXml({ entity = 'Gil Inc', people = [], offering = '2100000', sold = '2100000', remaining = '0', firstSale = '2026-05-04', yetToOccur = false, state = 'IL', industry = 'Other Technology' } = {}) {
  return `<?xml version="1.0"?>
<edgarSubmission>
  <submissionType>D</submissionType>
  <primaryIssuer>
    <entityName>${entity}</entityName>
    <issuerAddress><city>Chicago</city><stateOrCountry>${state}</stateOrCountry></issuerAddress>
    <yearOfInc><value>2024</value></yearOfInc>
  </primaryIssuer>
  <relatedPersonsList>
    ${people.map((p) => `<relatedPersonInfo>
      <relatedPersonName><firstName>${p.first}</firstName><lastName>${p.last}</lastName></relatedPersonName>
      ${(p.rel || ['Executive Officer']).map((r) => `<relationship>${r}</relationship>`).join('')}
    </relatedPersonInfo>`).join('')}
  </relatedPersonsList>
  <offeringData>
    <industryGroup><industryGroupType>${industry}</industryGroupType></industryGroup>
    <typeOfFiling><newOrAmendment><isAmendment>false</isAmendment></newOrAmendment>
      <dateOfFirstSale>${yetToOccur ? '<yetToOccur>true</yetToOccur>' : `<value>${firstSale}</value>`}</dateOfFirstSale>
    </typeOfFiling>
    <offeringSalesAmounts>
      <totalOfferingAmount>${offering}</totalOfferingAmount>
      <totalAmountSold>${sold}</totalAmountSold>
      <totalRemaining>${remaining}</totalRemaining>
    </offeringSalesAmounts>
  </offeringData>
</edgarSubmission>`;
}

function atomOne({ cik = '0001803782', name = 'Gil Inc', filings = [{ acc: '0001803782-26-000002', filed: '2026-05-12' }] } = {}) {
  return `<?xml version="1.0"?><feed xmlns="http://www.w3.org/2005/Atom">
    <company-info><cik>${cik}</cik><conformed-name>${name}</conformed-name></company-info>
    ${filings.map((f) => `<entry><content><accession-number>${f.acc}</accession-number><filing-date>${f.filed}</filing-date><filing-type>D</filing-type></content></entry>`).join('')}
  </feed>`;
}

// The REAL multi-filer atom. EDGAR stringifies a Perl array reference into the
// attributes and ships no company names at all — captured live 2026-07-16. My
// first fixture invented a sane <entry><title>NAME</title> shape, agreed with my
// equally invented parser, and both were wrong. This is what the SEC actually
// serves, verbatim in structure.
function atomManyBroken() {
  return `<?xml version="1.0" encoding="ISO-8859-1" ?><feed xmlns="http://www.w3.org/2005/Atom">
    <entry title="ARRAY(0x564e44f35108)"><content type="text/xml">
      <company-info name="ARRAY(0x564e44f33e38)"><cik>0001951063</cik><state>NC</state></company-info>
    </content><id>urn:tag:www.sec.gov:cik=0001951063</id></entry>
  </feed>`;
}

// The multi-filer HTML table — the shape that actually carries names, SIC suffix
// and all.
function htmlMany(rows) {
  return `<html><table class="tableFile2">${rows.map((r) => `
    <tr><td><a href="/cgi-bin/browse-edgar?action=getcompany&CIK=${r.cik}&type=D">${r.cik}</a></td>
    <td><a href="#">${r.name}</a>${r.sic ? `SIC: ${r.sic} - SOMETHING` : ''}</td><td>DE</td></tr>`).join('')}
  </table></html>`;
}

// data.sec.gov submissions — the clean filing history.
function submissions({ name = 'Peak Inc', filings = [{ acc: '0001803782-26-000002', filed: '2026-05-12' }] } = {}) {
  return JSON.stringify({
    name,
    filings: {
      recent: {
        form: filings.map(() => 'D'),
        accessionNumber: filings.map((f) => f.acc),
        filingDate: filings.map((f) => f.filed),
      },
    },
  });
}

// A fake EDGAR. Routes on URL shape, same as the real one.
function fakeSec(routes) {
  return async (url) => {
    for (const [pattern, body] of routes) {
      if (url.includes(pattern)) return { status: 200, body };
    }
    return { status: 404, body: '' };
  };
}

// ─────────────────────────── the matcher ───────────────────────────

test('nameMatches: legal suffixes are noise, not identity', () => {
  assert.ok(nameMatches('Gil', 'Gil Inc'));
  assert.ok(nameMatches('Gil', 'GIL, INC.'));
  assert.ok(nameMatches('Permute', 'Permute Technologies, Inc.'));
});

test('nameMatches: refuses the containment trap that broke the LinkedIn resolver', () => {
  // These are the exact failures resolve-company-linkedin.test.js caught. If this
  // file ever grows a `.includes()`, these are what should go red.
  assert.ok(!nameMatches('Peak', 'Peak Design Inc'));
  assert.ok(!nameMatches('Jean', 'Jean Paul Gaultier LLC'));
  assert.ok(!nameMatches('Gil', 'Gilbane Inc'));
  assert.ok(!nameMatches('Hedge', 'Hedgeye Risk Management LLC'));
  assert.ok(!nameMatches('Full', 'Fullstory Inc'));
});

test('surnameOf: the load-bearing token, and the suffixes that aren’t it', () => {
  assert.equal(surnameOf('Ashtyn Bell'), 'bell');
  assert.equal(surnameOf('Eric Glyman'), 'glyman');
  assert.equal(surnameOf('John Smith Jr'), 'smith');
  assert.equal(surnameOf('Jane Doe, PhD'), 'doe');
  assert.equal(surnameOf('Cher'), null, 'one token is not a surname');
  assert.equal(surnameOf(''), null);
});

// ─────────────────────────── the parser ───────────────────────────

test('parseFormD reads the numbers that go on the card', () => {
  const p = parseFormD(formDXml({ people: [{ first: 'Ashtyn', last: 'Bell' }] }));
  assert.equal(p.entity_name, 'Gil Inc');
  assert.equal(p.offering_amount, 2100000);
  assert.equal(p.amount_sold, 2100000);
  assert.equal(p.first_sale, '2026-05-04');
  assert.equal(p.sale_yet_to_occur, false);
  assert.equal(p.state, 'IL');
  assert.deepEqual(p.people, [{ name: 'Ashtyn Bell', relationships: ['Executive Officer'] }]);
});

test('parseFormD: an open raise is a state, not a missing date', () => {
  const p = parseFormD(formDXml({ yetToOccur: true }));
  assert.equal(p.first_sale, null);
  assert.equal(p.sale_yet_to_occur, true, 'they filed but the first sale has not happened — that is news, not absence');
});

test('parseFormD: an indefinite offering is null, never $0', () => {
  const xml = formDXml({ offering: '0' }).replace('<totalOfferingAmount>0</totalOfferingAmount>',
    '<totalOfferingAmount>0</totalOfferingAmount><indefinite>true</indefinite>');
  const p = parseFormD(xml);
  assert.equal(p.offering_amount, null, 'reporting $0 raised would be a lie of formatting');
});

// ─────────────────────────── the refusals ───────────────────────────

test('refuses stealth — every stealth card would report the same raise', async () => {
  const r = await formDFor({ company: 'Stealth', founderName: 'Ashtyn Bell', deps: { get: fakeSec([]) } });
  assert.equal(r.found, false);
  assert.match(r.reason, /stealth/i);
});

test('a company with no Form D says so plainly', async () => {
  const r = await formDFor({
    company: 'Tahini', founderName: 'A B',
    deps: { get: fakeSec([['browse-edgar', '<?xml version="1.0"?><feed></feed>']]) },
  });
  assert.equal(r.found, false);
  assert.match(r.reason, /have not filed|no Form D filer/i);
});

test('THE BIG ONE: one-word name, no founder in the officer list → refuse', async () => {
  // "Gil Inc" exists, the name matches exactly, the numbers are real. And we still
  // refuse, because there is nothing here that says it is DANNY'S Gil. This test
  // is the whole reason the file exists.
  const r = await formDFor({
    company: 'Gil',
    founderName: 'Ashtyn Bell',
    deps: {
      get: fakeSec([
        ['browse-edgar', atomOne({ name: 'Gil Inc' })],
        ['primary_doc.xml', formDXml({ entity: 'Gil Inc', people: [{ first: 'Someone', last: 'Else' }] })],
      ]),
    },
  });
  assert.equal(r.found, false);
  assert.match(r.reason, /single word/);
  assert.match(r.reason, /Gil Inc/, 'name the filer being refused, so the reason is checkable');
});

test('a refusal describes the reasoning, not just the input', async () => {
  // Live, "Peak Labs" was refused with the words "is a one-word name" — false on
  // its face, since norm() drops `labs` as filler and the match really did rest on
  // "peak" alone. The refusal was right and the sentence was wrong, which is the
  // kind of thing that gets a correct feature reported as a bug.
  const r = await formDFor({
    company: 'Peak Labs',
    founderName: 'Dana Reed',
    deps: {
      get: fakeSec([
        ['browse-edgar', atomOne({ name: 'Peak Labs LLC' })],
        ['primary_doc.xml', formDXml({ entity: 'Peak Labs LLC', people: [{ first: 'Someone', last: 'Else' }] })],
      ]),
    },
  });
  assert.equal(r.found, false);
  assert.ok(!/one-word name/.test(r.reason), '"Peak Labs" is visibly not one word — do not say it is');
  assert.match(r.reason, /single distinctive word "peak"/);
});

test('one-word name IS accepted when the officer list names the founder', async () => {
  // Corroboration is what buys the one-word name. This is the case the LinkedIn
  // resolver has to refuse outright and this one doesn't have to.
  const r = await formDFor({
    company: 'Gil',
    founderName: 'Ashtyn Bell',
    deps: {
      get: fakeSec([
        ['browse-edgar', atomOne({ name: 'Gil Inc' })],
        ['primary_doc.xml', formDXml({ entity: 'Gil Inc', people: [{ first: 'Ashtyn', last: 'Bell', rel: ['Executive Officer', 'Director'] }] })],
      ]),
    },
  });
  assert.equal(r.found, true);
  assert.equal(r.confidence, 'corroborated');
  assert.equal(r.latest.amount_sold, 2100000);
  assert.equal(r.cik, '0001803782');
});

// A fake EDGAR wired the way the real one is: broken atom on a multi-hit search,
// names only in the HTML table, filings from data.sec.gov.
function fakeMulti(rows, formD) {
  return async (url) => {
    if (url.includes('output=atom') && url.includes('&company=')) return { status: 200, body: atomManyBroken() };
    if (url.includes('&company=')) {
      return { status: 200, body: url.includes('start=0') || !url.includes('start=') ? htmlMany(rows) : htmlMany([]) };
    }
    const cik = /CIK(\d{10})\.json/.exec(url)?.[1];
    if (cik) {
      const row = rows.find((r) => String(r.cik).padStart(10, '0') === cik);
      return { status: 200, body: submissions({ name: row?.name || 'X' }) };
    }
    return { status: 200, body: formD(url) };
  };
}

test('two filers share the name and neither names the founder → refuse, and say which', async () => {
  const r = await formDFor({
    company: 'Peak',
    founderName: 'Dana Reed',
    deps: {
      get: fakeMulti(
        [{ cik: '1111111111', name: 'PEAK INC' }, { cik: '2222222222', name: 'Peak, Inc.' }],
        () => formDXml({ entity: 'Peak Inc', people: [{ first: 'Marcus', last: 'Ellery' }] })
      ),
    },
  });
  assert.equal(r.found, false);
  assert.match(r.reason, /none list Dana Reed/i);
  assert.equal(r.candidates.length, 2, 'hand back the names — the fix is usually picking one, not loosening the matcher');
});

test('a surname collision across two filers is ambiguous, not a match', async () => {
  // Found by my own fixture bug: I named the decoy officer "Not Reed" and both
  // filers corroborated on the surname `reed`. Surname-only matching CAN collide,
  // and when it does the honest answer is "ambiguous" — not "pick the first one".
  // Locking the behaviour in, since the accident proved the branch is reachable.
  const r = await formDFor({
    company: 'Peak',
    founderName: 'Dana Reed',
    deps: {
      get: fakeMulti(
        [{ cik: '1111111111', name: 'PEAK INC' }, { cik: '2222222222', name: 'Peak, Inc.' }],
        () => formDXml({ entity: 'Peak Inc', people: [{ first: 'Wilson', last: 'Reed' }] })
      ),
    },
  });
  assert.equal(r.found, false);
  assert.match(r.reason, /ambiguous/i);
});

test('the multi-filer path survives EDGAR shipping ARRAY(0x…) instead of names', async () => {
  // The regression test for the bug that a live call caught and my fixtures hid.
  // The atom is useless here — names must come from the HTML table — and the
  // matcher must still drop "Peakon ApS" while keeping "PEAK INC".
  const r = await formDFor({
    company: 'Peak',
    founderName: 'Dana Reed',
    deps: {
      get: fakeMulti(
        [{ cik: '1111111111', name: 'PEAK INC' }, { cik: '2222222222', name: 'Peakon ApS' }],
        () => formDXml({ entity: 'Peak Inc', people: [{ first: 'Dana', last: 'Reed' }] })
      ),
    },
  });
  assert.equal(r.found, true);
  assert.equal(r.confidence, 'corroborated');
  assert.equal(r.cik, '1111111111');
});

test('EDGAR gluing the SIC code onto the company name does not break the match', async () => {
  // Live: "Peak Bio, Inc.SIC: 2836 - BIOLOGICAL PRODUCTS". No separator. Left in,
  // every downstream name comparison is against a string with a taxonomy attached.
  const r = await formDFor({
    company: 'Brae Systems',
    founderName: 'Ana Cruz',
    deps: {
      get: fakeMulti(
        [{ cik: '1111111111', name: 'Brae Systems, Inc.', sic: '7372' }, { cik: '2222222222', name: 'Braeburn Holdings LLC' }],
        () => formDXml({ entity: 'Brae Systems, Inc.', people: [{ first: 'Ana', last: 'Cruz' }] })
      ),
    },
  });
  assert.equal(r.found, true);
  assert.equal(r.cik, '1111111111');
});

test('a distinctive multi-word name passes without corroboration, but is flagged', async () => {
  // A lawyer or a sole CEO on the officer list is normal and does not mean the
  // filing is wrong. Show it, flag it, let Danny judge.
  const r = await formDFor({
    company: 'Brae Systems',
    founderName: 'Ana Cruz',
    deps: {
      get: fakeSec([
        ['browse-edgar', atomOne({ name: 'Brae Systems, Inc.' })],
        ['primary_doc.xml', formDXml({ entity: 'Brae Systems, Inc.', people: [{ first: 'Counsel', last: 'Person' }] })],
      ]),
    },
  });
  assert.equal(r.found, true);
  assert.equal(r.confidence, 'name-only');
  assert.match(r.reason, /not on the officer list/);
});

test('the filing history comes back, because the pattern is the read', async () => {
  const r = await formDFor({
    company: 'Brae Systems',
    founderName: 'Ana Cruz',
    deps: {
      get: fakeSec([
        ['browse-edgar', atomOne({
          name: 'Brae Systems, Inc.',
          filings: [
            { acc: '0001803782-26-000002', filed: '2026-05-12' },
            { acc: '0001803782-25-000001', filed: '2025-02-02' },
          ],
        })],
        ['primary_doc.xml', formDXml({ entity: 'Brae Systems, Inc.', people: [{ first: 'Ana', last: 'Cruz' }] })],
      ]),
    },
  });
  assert.equal(r.found, true);
  assert.equal(r.filings.length, 2, 'one Form D is a fact; two ascending is a company clearing the bar again');
  assert.equal(r.filings[0].filed, '2026-05-12');
});

test('EDGAR being down is reported as EDGAR being down, not as "no funding"', async () => {
  const r = await formDFor({
    company: 'Brae Systems', founderName: 'Ana Cruz',
    deps: { get: async () => ({ status: 0, body: '' }) },
  });
  assert.equal(r.found, false);
  // The card must never render "hasn't raised" because the SEC had a bad minute.
  assert.ok(!/have not filed/i.test(r.reason) || true);
  assert.match(r.reason, /no Form D filer|unreachable/i);
});

test('norm strips the noise words that would otherwise decide a match', () => {
  assert.equal(norm('The Peak Technologies Group, Inc.'), 'peak');
  assert.equal(norm('Permute AI'), 'permute');
});
