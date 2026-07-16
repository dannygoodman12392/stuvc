'use strict';
// ══════════════════════════════════════════════════════════════════════════
// Form D — what a company raised, from the only source that can't spin it.
//
// Danny: "what you could learn from the company site and crunchbase, etc..."
//
// This is the "etc". Crunchbase was the ask and it is the wrong instrument for
// this book, for three reasons that all point the same way:
//
//   1. COVERAGE. Crunchbase is a record of what got ANNOUNCED. Danny writes
//      $150-400K checks into 3-person companies whose raise is a stack of SAFEs
//      and no press release. That company is a stub on Crunchbase, or absent.
//   2. LATENCY. Reg D requires the filing within 15 days of first sale. The
//      TechCrunch post comes when the founder feels like it — often a quarter
//      later, sometimes never. So on the cases that matter this is not a
//      substitute for Crunchbase, it is EARLIER than Crunchbase.
//   3. THE KEY DOESN'T EXIST. CRUNCHBASE_API_KEY has been sitting in .env as an
//      empty string. v4 needs a paid license; the "friend's account" is a web
//      login. Nothing was ever going to come out of that pipe.
//
// EDGAR is free, needs no key, and is a legal filing — the numbers in it were
// sworn to, not pitched. `filing` was already a declared SOURCE_KIND in
// lib/signals.js with a label in the card UI. The socket was built. This is the
// plug.
//
// ── THE HAZARD, WHICH IS THE SAME ONE AS EVER ──
// resolve-company-linkedin.js exists because of confident-wrong-results, and the
// risk here is identical in shape and worse in consequence: attribute another
// company's Form D to Danny's card and Stu reports a $40M Series B for a company
// that has raised $900K. He'd walk into IC with it. The board is full of names
// that beg for this — Gil, Peak, Jean, Hedge, Prizm, Merlon, Full — and EDGAR's
// company search is a PREFIX match, so "Gil" returns every filer starting Gil.
//
// But this file has something the LinkedIn resolver never had: Form D names the
// company's officers and directors. That is an identity check, not a similarity
// score. A "Gil Inc" filing with Ashtyn in the officer list is Danny's Gil. One
// without is a coin flip. So corroboration here is real evidence, and it's what
// lets us accept a one-word name that the LinkedIn resolver has to refuse
// outright.
//
// Verified live 2026-07-16 against Ramp Business Corp (CIK 0001803782):
//   browse-edgar ?action=getcompany&type=D&output=atom -> conformed-name, cik,
//     and every Form D with accession + filing-date.
//   Archives/.../primary_doc.xml -> totalOfferingAmount 199999557,
//     totalAmountSold 199999557, dateOfFirstSale 2025-06-16, officers w/ names.
// ══════════════════════════════════════════════════════════════════════════

const https = require('https');

// SEC requires a declared identity on every request and will 403 a generic agent.
// This is a fair-access rule, not an auth check — see sec.gov/os/webmaster-faq.
const UA = 'Strider Capital danny@strider.capital';

// SEC asks for <= 10 req/s. We're far under, but a bulk backfill across 100 cards
// is exactly where a polite client stops being polite by accident.
const MIN_GAP_MS = 120;
let lastCall = 0;

const NOISE = /\b(inc|llc|l l c|ltd|corp|corporation|co|company|technologies|technology|labs?|group|holdings|ai|io|hq|the)\b/g;

function norm(s) {
  return String(s || '')
    .toLowerCase()
    .normalize('NFKD').replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]+/g, ' ')
    .replace(NOISE, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

// Equality after normalization — NOT inclusion. Inclusion is the bug that turns
// "Peak" into "Peak Design"; see resolve-company-linkedin.js, where its own test
// caught it. A legal entity name is a curated string, so equality is realistic
// here in a way it isn't for a page title: Danny's "Gil" files as "Gil Inc",
// which norms to "gil". "Gilbane" norms to "gilbane" and is correctly rejected.
function nameMatches(company, conformed) {
  const want = norm(company);
  const got = norm(conformed);
  return Boolean(want && got && want === got);
}

// The surname is the load-bearing token. First names are noisy in filings
// (Mike/Michael, Kate/Katherine, middle initials); surnames are not, and a
// surname collision inside an already name-matched filer is vanishingly rare.
function surnameOf(founderName) {
  const parts = String(founderName || '').trim().split(/\s+/).filter(Boolean);
  if (parts.length < 2) return null;
  const last = parts[parts.length - 1].toLowerCase().replace(/[^a-z]/g, '');
  // Suffixes are not surnames.
  if (['jr', 'sr', 'ii', 'iii', 'iv', 'phd', 'md'].includes(last)) {
    return parts.length >= 3 ? parts[parts.length - 2].toLowerCase().replace(/[^a-z]/g, '') : null;
  }
  return last.length >= 2 ? last : null;
}

function httpGet(url, headers = {}) {
  return new Promise((resolve) => {
    const req = https.get(url, { headers: { 'User-Agent': UA, ...headers } }, (res) => {
      let b = '';
      res.on('data', (c) => (b += c));
      res.on('end', () => resolve({ status: res.statusCode, body: b }));
    });
    req.on('error', () => resolve({ status: 0, body: '' }));
    req.setTimeout(20000, () => { req.destroy(); resolve({ status: 0, body: '' }); });
  });
}

async function politeGet(url, deps) {
  const get = deps.get || httpGet;
  if (!deps.get) {
    const wait = Math.max(0, MIN_GAP_MS - (Date.now() - lastCall));
    if (wait) await new Promise((r) => setTimeout(r, wait));
    lastCall = Date.now();
  }
  return get(url);
}

// ── Minimal XML plucking ──
// A parser dependency for six tags is not worth the supply chain. EDGAR's XML is
// machine-generated, flat, and has no attributes or namespaces on these fields.
function tag(xml, name) {
  const m = new RegExp(`<${name}>([^<]*)</${name}>`, 'i').exec(xml);
  return m ? m[1].trim() : null;
}
function tagAll(xml, name) {
  const out = [];
  const re = new RegExp(`<${name}>([^<]*)</${name}>`, 'gi');
  let m;
  while ((m = re.exec(xml))) out.push(m[1].trim());
  return out;
}
function blocks(xml, name) {
  const out = [];
  const re = new RegExp(`<${name}>([\\s\\S]*?)</${name}>`, 'gi');
  let m;
  while ((m = re.exec(xml))) out.push(m[1]);
  return out;
}

function num(v) {
  if (v == null || v === '') return null;
  const n = Number(String(v).replace(/[^0-9.]/g, ''));
  return Number.isFinite(n) ? n : null;
}

/** Parse a Form D primary_doc.xml into the handful of facts worth showing. */
function parseFormD(xml) {
  const people = blocks(xml, 'relatedPersonInfo').map((b) => {
    const name = [tag(b, 'firstName'), tag(b, 'middleName'), tag(b, 'lastName')]
      .filter(Boolean).join(' ').replace(/\s+/g, ' ').trim();
    return { name, relationships: tagAll(b, 'relationship') };
  }).filter((p) => p.name);

  // dateOfFirstSale lives inside <dateOfFirstSale><value>…</value>, and when the
  // raise hasn't closed the filer ticks <yetToOccur> instead. Both are meaningful
  // and they are not the same thing as "unknown".
  const firstSaleBlock = blocks(xml, 'dateOfFirstSale')[0] || '';
  const firstSale = tag(firstSaleBlock, 'value') || null;
  const yetToOccur = /<yetToOccur>\s*true\s*<\/yetToOccur>/i.test(firstSaleBlock);

  const offering = num(tag(xml, 'totalOfferingAmount'));
  const sold = num(tag(xml, 'totalAmountSold'));
  const remaining = num(tag(xml, 'totalRemaining'));

  return {
    entity_name: tag(xml, 'entityName'),
    // "Indefinite" offerings file 0 with an <indefinite> flag. Reporting $0 raised
    // would be a lie of formatting, so an unusable number is null, not zero.
    offering_amount: offering === 0 && /indefinite/i.test(xml) ? null : offering,
    amount_sold: sold,
    amount_remaining: remaining,
    first_sale: firstSale,
    sale_yet_to_occur: yetToOccur,
    industry: tag(xml, 'industryGroupType'),
    state: tag(xml, 'stateOrCountry'),
    year_of_inc: tag(xml, 'yearOfInc') || null,
    people,
  };
}

function accessionPath(cik, accession) {
  const bare = String(accession).replace(/-/g, '');
  return `https://www.sec.gov/Archives/edgar/data/${Number(cik)}/${bare}/primary_doc.xml`;
}

// ── EDGAR's company search has TWO shapes, and the second one is broken ──
//
// Ask for ONE filer and `&output=atom` is clean: <conformed-name> plus the whole
// filing list. Ask for a name that hits SEVERAL and the atom comes back with
//
//     <entry title="ARRAY(0x564e44f35108)">
//        <company-info name="ARRAY(0x564e44f33e38)">
//
// — a Perl array reference stringified into the attribute. The company NAMES are
// simply not in that document. Measured live 2026-07-16: 61KB of results for
// "peak", zero usable names.
//
// This bit me. The first cut of this file parsed `<entry>` (no attribute) and so
// matched nothing and returned "no Form D filer by that name" — a confident FALSE
// NEGATIVE, on precisely the ambiguous short names the file exists to handle. My
// own fixtures agreed with me because I'd invented the shape. Only a live call
// caught it.
//
// So: atom for the single-filer case (it works and it's cheap), and the HTML table
// for the many-filer case, which is ugly but is the one EDGAR actually populates.
const SEARCH_PAGE = 100;
const MAX_SEARCH_PAGES = 3;   // ~300 candidates. "peak" has 195 type-D filers.

function searchUrl(company, { atom = false, start = 0 } = {}) {
  return 'https://www.sec.gov/cgi-bin/browse-edgar?action=getcompany'
    + `&company=${encodeURIComponent(company)}&type=D&dateb=&owner=include`
    + `&count=${atom ? 40 : SEARCH_PAGE}&start=${start}${atom ? '&output=atom' : ''}`;
}

/** Rows of {cik, name} out of the multi-filer HTML table. */
function parseFilerTable(htmlBody) {
  const out = [];
  const re = /CIK=(\d{10})&[^"]*"[^>]*>[^<]*<\/a><\/td>\s*<td[^>]*>([\s\S]*?)<\/td>/gi;
  let m;
  while ((m = re.exec(htmlBody))) {
    // EDGAR jams the SIC code onto the end of the name with no separator:
    // "Peak Bio, Inc.SIC: 2836 - BIOLOGICAL PRODUCTS". Split it off or every
    // name comparison downstream is against a string with a taxonomy glued to it.
    const name = m[2].replace(/<[^>]+>/g, '').split('SIC:')[0]
      .replace(/&amp;/g, '&').replace(/&#39;/g, "'").replace(/&quot;/g, '"')
      .replace(/\s+/g, ' ').trim();
    if (name) out.push({ cik: m[1], name, filings: null });
  }
  return out;
}

/** Candidate filers whose name matches, from EDGAR's company-name search. */
async function searchFilers({ company, deps = {} }) {
  const first = await politeGet(searchUrl(company, { atom: true }), deps);
  if (first.status !== 200 || !first.body) return [];

  // Single-filer shape — the good one.
  const cik = tag(first.body, 'cik') || tag(first.body, 'CIK');
  const conformed = tag(first.body, 'conformed-name');
  if (cik && conformed) {
    const filings = blocks(first.body, 'entry').map((e) => ({
      accession: tag(e, 'accession-number'),
      filed: tag(e, 'filing-date'),
      type: tag(e, 'filing-type'),
    })).filter((f) => f.accession && /^D/i.test(f.type || ''));
    return [{ cik, name: conformed, filings }];
  }

  // Many-filer shape. The search is a PREFIX match returning alphabetically, so
  // "Peak Inc" sorts behind "Peak 15 Capital", "Peak Alabama Fund", "Peak
  // Ballpark Estates"… and a single 40-row page never reaches it. Page until the
  // list runs out.
  const rows = [];
  for (let p = 0; p < MAX_SEARCH_PAGES; p++) {
    const { status, body } = await politeGet(searchUrl(company, { start: p * SEARCH_PAGE }), deps);
    if (status !== 200 || !body) break;
    const batch = parseFilerTable(body);
    rows.push(...batch);
    if (batch.length < SEARCH_PAGE) break;
  }
  return rows;
}

/**
 * A filer's Form D history. data.sec.gov is the clean path — it's JSON, it's the
 * authoritative submissions index, and it works for tiny private filers (verified
 * against a one-filing LLC). browse-edgar was the alternative and it's HTML.
 */
async function filingsFor({ cik, deps = {} }) {
  const padded = String(cik).replace(/\D/g, '').padStart(10, '0');
  const { status, body } = await politeGet(`https://data.sec.gov/submissions/CIK${padded}.json`, deps);
  if (status !== 200 || !body) return [];
  let d;
  try { d = JSON.parse(body); } catch { return []; }
  const r = d?.filings?.recent;
  if (!r?.form) return [];
  const out = [];
  for (let i = 0; i < r.form.length; i++) {
    if (!/^D(\/A)?$/i.test(r.form[i])) continue;
    out.push({ accession: r.accessionNumber[i], filed: r.filingDate[i], type: r.form[i] });
  }
  // Newest first — the caller reads [0] as "the latest raise".
  out.sort((a, b) => String(b.filed).localeCompare(String(a.filed)));
  return out;
}

/**
 * What did this company raise, per the SEC?
 *
 * Returns `{ found:false, reason }` far more often than `found:true`, and that is
 * the point. An empty funding block says "unknown", which is true. A wrong one
 * says something false in a voice that sounds like the federal government.
 *
 * @returns {Promise<{found:boolean, reason:string, confidence?:'corroborated'|'name-only',
 *   cik?:string, entity_name?:string, filings?:Array, latest?:object, candidates?:string[]}>}
 */
async function formDFor({ company, founderName, deps = {} }) {
  const name = String(company || '').trim();
  if (!name) return { found: false, reason: 'no company name' };

  // Same refusal as the LinkedIn resolver, same reason. "Stealth" is not a company
  // name; searching it returns whichever entity last used the word, and every
  // stealth card would report the same raise.
  if (/^stealth/i.test(norm(name))) return { found: false, reason: 'stealth — no company to look up' };
  if (norm(name).length < 2) return { found: false, reason: 'company name too short to search safely' };

  let filers;
  try {
    filers = await searchFilers({ company: name, deps });
  } catch (e) {
    return { found: false, reason: `EDGAR unreachable: ${e.message}` };
  }
  if (!filers.length) return { found: false, reason: 'no Form D filer by that name — most likely they have not filed one' };

  const matches = filers.filter((f) => nameMatches(name, f.name));
  if (!matches.length) {
    return {
      found: false,
      reason: `no filer name matches "${name}"`,
      candidates: filers.slice(0, 5).map((f) => f.name),
    };
  }

  // ── Corroborate against the officer list ──
  // With one match we could stop here, and for a distinctive multi-word name that
  // would be fine. We don't, because the whole reason this file is careful is the
  // one-word names, and for those the officer list is the only thing standing
  // between Danny and another company's balance sheet.
  const surname = surnameOf(founderName);
  const scored = [];
  for (const f of matches.slice(0, 5)) {
    const filings = f.filings || (await filingsFor({ cik: f.cik, deps }));
    if (!filings.length) continue;
    const latest = filings[0];
    const { status, body } = await politeGet(accessionPath(f.cik, latest.accession), deps);
    if (status !== 200 || !body) continue;
    const parsed = parseFormD(body);
    const corroborated = Boolean(
      surname && parsed.people.some((p) => surnameOf(p.name) === surname)
    );
    scored.push({ filer: f, filings, latest: { ...parsed, filed: latest.filed, accession: latest.accession }, corroborated });
  }

  if (!scored.length) return { found: false, reason: 'filer matched but no readable Form D document' };

  const corroborated = scored.filter((s) => s.corroborated);

  if (corroborated.length === 1) return ok(corroborated[0], 'corroborated', `officer list names ${founderName}`);

  // More than one filer matches the name and the founder is in none of them. This
  // is precisely the Peak Design case. Refuse, and hand back the names so the
  // reason is actionable — the fix is usually pasting the right one, not a looser
  // matcher.
  if (scored.length > 1) {
    return {
      found: false,
      reason: corroborated.length > 1
        ? `${corroborated.length} filers match and name ${founderName} — ambiguous`
        : `${scored.length} filers named "${name}" and none list ${founderName || 'the founder'} as an officer`,
      candidates: scored.map((s) => `${s.filer.name} (CIK ${s.filer.cik})`),
    };
  }

  const only = scored[0];
  if (only.corroborated) return ok(only, 'corroborated', `officer list names ${founderName}`);

  // One filer, name matches, founder not in the officer list. This is a real state
  // and not necessarily wrong — a solo founder can file with a lawyer as the sole
  // listed officer, and plenty of Form Ds list only a CEO who isn't the technical
  // co-founder Danny met. So we return it, flagged, rather than hiding it.
  //
  // Unless the match rests on ONE word. That's the "Peak" case with the safety
  // off, and it doesn't get through.
  const distinctive = norm(name).split(' ').filter(Boolean);
  if (distinctive.length === 1) {
    // Say what is actually true. An earlier draft called "Peak Labs" a "one-word
    // name", which is visibly false to anyone reading it — norm() drops `labs` as
    // filler, so the match really did come down to "peak", but the sentence
    // described the input rather than the reasoning. A refusal whose stated reason
    // is wrong reads as a broken feature even when the refusal is correct.
    const collapsed = norm(name) !== String(name).trim().toLowerCase();
    return {
      found: false,
      reason: collapsed
        ? `"${name}" comes down to the single distinctive word "${distinctive[0]}", and ${only.filer.name} doesn't list ${founderName || 'the founder'} as an officer — too easy to confuse with another filer`
        : `"${name}" is a single word and ${only.filer.name} doesn't list ${founderName || 'the founder'} as an officer — too easy to confuse with another filer`,
      candidates: [`${only.filer.name} (CIK ${only.filer.cik})`],
    };
  }
  return ok(only, 'name-only', `name matches exactly; ${founderName || 'the founder'} is not on the officer list`);

  function ok(s, confidence, why) {
    return {
      found: true,
      reason: why,
      confidence,
      cik: s.filer.cik,
      entity_name: s.filer.name,
      latest: s.latest,
      // The history is the story. One Form D is a fact; four of them ascending is
      // a company that keeps clearing the bar, and that pattern is the read.
      filings: s.filings.map((f) => ({ accession: f.accession, filed: f.filed })),
      source_url: `https://www.sec.gov/cgi-bin/browse-edgar?action=getcompany&CIK=${s.filer.cik}&type=D`,
      fetched_at: new Date().toISOString(),
    };
  }
}

module.exports = { formDFor, parseFormD, nameMatches, surnameOf, searchFilers, norm };
