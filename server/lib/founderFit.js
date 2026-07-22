'use strict';
// ══════════════════════════════════════════════════════════════════════════
// founderFit — the founder-quality check Danny asked for, in his own terms.
//
// "I want a founder quality check you can run against candidates to identify,
// select, and prioritize who I should meet. I want to meet pre-seed/stealth/early
// builders who have Chicago/Illinois ties AND: hyperscale experience, or previous
// founding experience, or exited a startup in a good way (which is better to me
// than previous founding experience), they got into or have been in YC, they are
// members of South Park Commons, they got into or have been in a16z speedrun or
// Z Fellows, they have raised venture capital previously, or they went to a
// prestigious Chicago/IL school and have a track record that lends itself to
// building outliers."
//
// The rubric is two GATES and one SCORE, and keeping them separate is the whole
// point — it's the distinction the old caliber scorer collapsed.
//
//   GATE 1 — STAGE (of the CURRENT company). Must be earliest-stage: stealth,
//     pre-seed, just incorporated, building. A company that is clearly PAST that —
//     a Series A, a big priced round, real scale — fails, no matter how strong the
//     founder. This is the Matt Silver / Cargado fix: he's a strong founder, but
//     Cargado is not a company at the stage Danny wants to meet.
//
//   GATE 2 — ILLINOIS TIE. Handled upstream by lib/ilTie + the queue's TIE_CLAUSE;
//     this module trusts a verified tie and never invents one.
//
//   SCORE — the OUTLIER MARKERS, which describe the founder's BACKGROUND, not the
//     current company. "Raised VC previously" and "prior exit" are background wins;
//     they belong here, NOT in the stage gate. This separation is exactly why the
//     old scorer failed: it read "raised institutional capital" off the current
//     company and rewarded it, pulling in companies already underway.
//
// THE CARDINAL RULE, inherited from the honesty gate: a marker only counts if its
// evidence quote is verbatim in the profile text. detect() returns the substring
// that fired, and markersFor() drops any whose quote isn't actually present. The
// "Why they're here" line is built from what survives — which is the fix for
// "some of the descriptions are good, some are bad": a chip cannot appear without
// a receipt.
// ══════════════════════════════════════════════════════════════════════════

// ── Text plumbing ──
function normText(s) {
  return String(s || '').toLowerCase().replace(/[^a-z0-9 ]+/g, ' ').replace(/\s+/g, ' ').trim();
}
function reWord(w) {
  return new RegExp(`(?:^|[^a-z0-9])${w.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}(?:[^a-z0-9]|$)`, 'i');
}

// Build the searchable blob from a sourced_founders row. Deliberately excludes
// score_rationale and any machine-written narrative — a marker must be grounded in
// the SOURCE material (headline, bio, history, tie text), never in another model's
// prose about the person, or one scorer's guess becomes the next scorer's "fact".
function profileText(row = {}) {
  const parseArr = (v) => {
    if (Array.isArray(v)) return v;
    if (typeof v !== 'string' || !v) return [];
    try { const p = JSON.parse(v); return Array.isArray(p) ? p : [String(p)]; } catch { return [v]; }
  };
  const parts = [
    row.headline, row.role, row.company, row.company_one_liner,
    row.chicago_connection, row.previous_company_norm,
    ...parseArr(row.pedigree_signals),
    ...parseArr(row.builder_signals),
    ...parseArr(row.tags),
  ];
  // raw_data / enriched_data hold the scraped profile text (bio, experience).
  for (const blob of [row.raw_data, row.enriched_data, row.linkedin_data]) {
    if (typeof blob === 'string' && blob) {
      try {
        const o = JSON.parse(blob);
        for (const k of ['bio', 'summary', 'about', 'headline', 'experience', 'description', 'snippet', 'text']) {
          if (typeof o[k] === 'string') parts.push(o[k]);
        }
        if (Array.isArray(o.experience)) for (const e of o.experience) parts.push(e && (e.title || e.company || e.description));
      } catch { parts.push(blob); }
    }
  }
  // Strip URLs before anything matches against this. A scraped LinkedIn profile is
  // full of "https://www.linkedin.com/…", and the word "linkedin" inside that URL
  // was firing the Hyperscaler:LinkedIn marker on 23 people who never worked there —
  // the URL boundary (the dot) looks like a word boundary to the matcher. Company
  // slugs in URLs (github.com/acme, /company/stripe) pollute every marker the same
  // way. Markers must match human prose, never link plumbing.
  return parts.filter(Boolean).map(String).join(' • ').replace(/https?:\/\/\S+/gi, ' ');
}

// ══════════════════════════════════════════════════════════════════════════
// STRUCTURED employment + education — the ground truth, when we have it.
//
// Danny: "the hyperscale experience tag is hallucinating ... make sure this is
// calibrated to read, understand, and interpret accurately their real LinkedIn
// history." He's right, and the cause is that the old detector matched a company
// NAME anywhere in a text blob — so "AI for Amazon sellers", "backed by
// ex-Googlers", or a customer logo all fired "Hyperscaler: Amazon". A company
// mention is not employment.
//
// The LinkedIn scrape carries a real experiences[] array — {company, title,
// starts_at, ends_at}. That is where someone actually WORKED, and it's un-
// hallucinatable: a product blurb naming Amazon never appears there. When we have
// it, employment markers read it and nothing else. Only when there's no structured
// history do we fall back to free text — and then demand an employment cue next to
// the company, never a bare mention.
// ══════════════════════════════════════════════════════════════════════════
function structuredProfile(row = {}) {
  const employers = []; // { company, title }
  const schools = [];   // school name
  for (const blob of [row.linkedin_data, row.enriched_data]) {
    if (typeof blob !== 'string' || !blob) continue;
    let o; try { o = JSON.parse(blob); } catch { continue; }
    const exp = o.experiences || o.experience || o.positions || [];
    if (Array.isArray(exp)) {
      for (const e of exp) {
        if (e && (e.company || e.title)) employers.push({ company: String(e.company || ''), title: String(e.title || '') });
      }
    }
    const edu = o.education || o.educations || [];
    if (Array.isArray(edu)) {
      for (const e of edu) {
        const s = e && (e.school || e.school_name || e.name);
        if (s) schools.push(String(s));
      }
    }
  }
  return { employers, schools, hasStructured: employers.length > 0 || schools.length > 0 };
}

// ══════════════════════════════════════════════════════════════════════════
// GATE 1 — CURRENT-COMPANY STAGE
//
// Returns { stage, tooLate, evidence }. `tooLate` true means the current company is
// past the earliest stage Danny wants to meet.
//
// The hard part is telling the CURRENT company's stage from the founder's history.
// The rule of thumb encoded here: earliest-stage language ("stealth", "pre-seed",
// "building", "day one") describes NOW; disqualifiers are only counted when they
// aren't clearly flagged as prior/background ("previously", "prior", "ex-", "sold").
// When in doubt this leans PERMISSIVE — it would rather admit a borderline company
// and let the score sort it than wrongly exclude a stealth founder whose bio happens
// to mention a past Series A they left. The LLM pass refines the genuinely ambiguous.
// ══════════════════════════════════════════════════════════════════════════

const EARLIEST_MARKERS = [
  /\bstealth\b/i, /\bpre[- ]?seed\b/i, /\bpre[- ]?launch\b/i, /\bday (one|1|zero|0)\b/i,
  /\bbuilding something\b/i, /\bworking on something\b/i, /\bjust (started|left|incorporated)\b/i,
  /\bnew ?co\b/i, /\bnewco\b/i, /\bexploring what'?s? next\b/i, /\bfounder mode\b/i,
  /\bincorporated\b/i, /\bfounding\b/i, /\b0 ?(to|->|→) ?1\b/i,
];

// Past-earliest markers. Each carries a matcher for "is this about a PRIOR company?"
// so a background mention doesn't disqualify the current one.
// Unconditional disqualifiers: the current company is plainly past the earliest
// stage. Each is background-aware (a "previously" in front is not disqualifying).
const PAST_EARLIEST = [
  { re: /\bseries\s+[a-e]\b/i, label: 'Series A+' },
  { re: /\b(pre[- ]?ipo|post[- ]?ipo|publicly traded|nasdaq|nyse|ipo'?d)\b/i, label: 'public / late-stage' },
  { re: /\b(\d{2,3})\+?\s*employees\b/i, label: 'sizable headcount', min: (m) => parseInt(m[1], 10) >= 50 },
  { re: /\braised\s+\$?\s?(\d+(?:\.\d+)?)\s*(m|mm|million)\b/i, label: 'large round', min: (m) => parseFloat(m[1]) >= 5 },
  { re: /\b(\d{3,})\+?\s*(customers|enterprises|clients)\b/i, label: 'many customers', min: (m) => parseInt(m[1], 10) >= 100 },
];
// Cues that a nearby round/scale marker describes a PRIOR company, not the current
// one. Deliberately excludes "ex-" and "former" — those describe a person's job
// history ("ex-Stripe engineer"), not a funding round's recency, and including them
// let an "ex-Stripe" 30 chars upstream launder a current "Series B" into "prior".
const PRIOR_CUES = /\b(previous|previously|prior|sold|acquired|exited|last (company|startup|venture)|before (that|founding)|first company|earlier)\b/i;

// The Cargado case. A closed institutional SEED (not pre-seed) on the current
// company, PLUS real traction, is past the earliest stage Danny wants — that is
// exactly the Matt Silver / Cargado profile he flagged: strong repeat founder,
// but a seed-funded company already shipping to customers. A pre-seed raise does
// NOT trip this — pre-seed is precisely what he's hunting.
const CURRENT_SEED = /\b(raised|closed|announced)\b[^.]{0,30}\bseed\b/i;
const PRESEED = /\bpre[- ]?seed\b/i;
const TRACTION = /\b(customers|paying|revenue|arr|mrr|users|logos|design partners|profitable|scaled)\b/i;

function classifyStage(text) {
  const t = String(text || '');
  const evidence = [];

  const earliest = EARLIEST_MARKERS.filter((re) => re.test(t)).length;

  let tooLate = false;
  for (const d of PAST_EARLIEST) {
    const m = t.match(d.re);
    if (!m) continue;
    if (d.min && !d.min(m)) continue; // e.g. a $2M raise, or 12 employees — still early
    // Is this disqualifier flagged as background? Look at the ~60 chars before it.
    const idx = m.index || 0;
    const before = t.slice(Math.max(0, idx - 60), idx);
    if (PRIOR_CUES.test(before)) continue; // "previously raised $10M" — that's a WIN, not a stage
    tooLate = true;
    evidence.push(`${d.label}: "${m[0].trim()}"`);
  }

  // Seed-with-traction on the current company (and not merely pre-seed).
  if (!tooLate) {
    const seed = t.match(CURRENT_SEED);
    if (seed && !PRESEED.test(t) && TRACTION.test(t)) {
      const idx = seed.index || 0;
      const before = t.slice(Math.max(0, idx - 60), idx);
      if (!PRIOR_CUES.test(before)) {
        tooLate = true;
        evidence.push(`seed + traction on current co: "${seed[0].trim()}"`);
      }
    }
  }

  let stage;
  if (tooLate) stage = 'past-earliest';
  else if (earliest > 0) stage = 'earliest';
  else stage = 'unknown';
  return { stage, tooLate, earliestMarkers: earliest, evidence };
}

// ══════════════════════════════════════════════════════════════════════════
// THE OUTLIER MARKERS — Danny's list, each an evidence-bearing detector.
//
// weight encodes his stated ranking: a good exit outranks prior founding
// ("better to me than previous founding experience"); the top programs and a prior
// raise sit between. detect(t) returns the verbatim substring that fired, or null.
// ══════════════════════════════════════════════════════════════════════════

const HYPERSCALERS = [
  'google', 'alphabet', 'meta', 'facebook', 'apple', 'amazon', 'aws', 'microsoft',
  'netflix', 'nvidia', 'openai', 'anthropic', 'stripe', 'databricks', 'snowflake',
  'palantir', 'tesla', 'spacex', 'uber', 'airbnb', 'coinbase', 'ramp', 'figma',
  'deepmind', 'salesforce', 'linkedin', 'doordash', 'instacart', 'robinhood',
];
const IL_ELITE_SCHOOLS = [
  'northwestern', 'university of chicago', 'uchicago', 'booth', 'kellogg',
  'university of illinois', 'uiuc', 'illinois institute of technology', 'illinois tech',
];

function firstMatch(t, re) {
  const m = String(t).match(re);
  return m ? m[0].trim() : null;
}

// Does `company` appear as a real EMPLOYER in `text` — not just mentioned? Requires
// an employment cue immediately next to the name, inside a tight window, so
// "AI for Amazon sellers" or "backed by ex-Googlers advising us" cannot fire while
// "SWE at Amazon", "9 years at Amazon", "ex-Amazon", "Amazon engineer" do. Returns
// the matched employment phrase, or null.
const ROLE_WORDS = 'swe|engineer|software engineer|ml engineer|scientist|researcher|research scientist|pm|product manager|designer|architect|developer|intern|analyst|lead|manager|director|vp|vice president|head|founder|cofounder|co-founder|president|officer|cto|ceo|coo|cpo';
// Words that make an adjacent "at COMPANY" mean employment, not location or aim.
// A bare "at COMPANY" is NOT enough — "aimed at Google", "sell at Amazon scale" are
// not jobs. Employment needs a role, a tenure, or a history word right in front.
const HISTORY_WORDS = 'previously|prior|formerly|spent|before|earlier|was';
// Non-employment framings that must VETO a match even when a company name is near a
// cue: the ex-Googler is a backer/advisor, not the founder; the company is a
// customer/partner, not an employer.
const EMPLOYMENT_VETO = /\b(backed by|investors?|investor|advis|angel|customer|client|partner|integrat|acquired by|sold to|competitor|for)\b/i;

function employedAtInText(company, text) {
  const c = company.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const frames = [
    // "<role> at/@/, Amazon"
    new RegExp(`(?:${ROLE_WORDS})\\s+(?:at|@|,)\\s*${c}\\b`, 'i'),
    // "Amazon engineer" (role AFTER the company)
    new RegExp(`\\b${c}\\s+(?:${ROLE_WORDS})\\b`, 'i'),
    // "ex-Amazon", "former(ly) (at) Amazon"
    new RegExp(`\\bex-?\\s*${c}\\b`, 'i'),
    new RegExp(`\\bformer(?:ly)?\\s+(?:at\\s+)?${c}\\b`, 'i'),
    // "joined/worked at/interned at Amazon"
    new RegExp(`\\b(?:joined|worked\\s+at|interned?\\s+at)\\s+${c}\\b`, 'i'),
    // "9 years at Amazon"
    new RegExp(`\\b\\d+\\+?\\s*years?\\s+(?:at|@)\\s+${c}\\b`, 'i'),
    // History word + "at/@ Amazon": "previously at Meta", "spent 4 years... at Meta"
    new RegExp(`\\b(?:${HISTORY_WORDS})\\b[^.]{0,15}?\\b(?:at|@)\\s+${c}\\b`, 'i'),
  ];
  for (const re of frames) {
    const m = String(text).match(re);
    if (!m) continue;
    // Veto if this sits in a backing/advisor/customer frame — look just before it.
    const idx = m.index || 0;
    const before = String(text).slice(Math.max(0, idx - 22), idx);
    if (EMPLOYMENT_VETO.test(before)) continue;
    return m[0].replace(/\s+/g, ' ').trim();
  }
  return null;
}

const cap = (s) => String(s).replace(/\b\w/g, (ch) => ch.toUpperCase());

const MARKERS = [
  {
    key: 'prior_exit',
    label: 'Exited a startup',
    weight: 10, // "better to me than previous founding experience"
    detect(t) {
      const m = String(t).match(/\b(acquired by [a-z0-9][\w .&-]{1,40}|was acquired|got acquired|successful(ly)? (exit|sold)|prior exit|previously exited|sold (my|our|the|his|her|a) (company|startup|business)|ipo'?d)\b/i);
      if (!m) return null;
      const big = /\$\s?\d{2,}\s?(m|mm|million|b|bn|billion)\b/i.test(t) || /\b(unicorn|nine[- ]figure)\b/i.test(t);
      return { quote: m[0].trim(), label: big ? 'Exited a startup (significant)' : 'Exited a startup' };
    },
  },
  {
    key: 'yc',
    label: 'YC',
    weight: 8,
    // Must catch the bare phrasing too — "YC alum", "YC-backed", "(YC S24)" and
    // "Y Combinator" are all the same signal. The cohort-code-only version silently
    // dropped every plain "YC alum", which is the single most common way it's written.
    detect(t) { return firstMatch(t, /\by[- ]?combinator\b|\bycombinator\b|\byc\s?[wsf]?\d{2}\b|\(yc[ .)]|\byc\s+(alum|backed|founder|company|s\d|w\d)|\bbacked by yc\b/i); },
  },
  {
    key: 'speedrun_zfellows',
    label: 'a16z Speedrun / Z Fellows',
    weight: 8,
    detect(t) { return firstMatch(t, /a16z\s+speedrun|andreessen\s+speedrun|\bspeedrun\b|\bz[- ]?fellows?\b|\bzfellows\b/i); },
  },
  {
    key: 'spc',
    label: 'South Park Commons',
    weight: 7,
    detect(t) { return firstMatch(t, /south\s+park\s+commons|\bspc\b/i); },
  },
  {
    key: 'prior_raise',
    label: 'Raised VC previously',
    weight: 6,
    // Must be flagged as PRIOR — a raise on the current company is a stage fact, not
    // a background win. This is the exact line the old scorer failed to draw.
    detect(t) {
      const re = /\b(previously|prior|formerly|at (my|his|her) (last|previous|first))\b[^.]{0,50}\b(raised|backed by|venture[- ]backed|vc[- ]backed|seed|series [a-d])\b/i;
      const m = String(t).match(re);
      return m ? m[0].trim() : null;
    },
  },
  {
    key: 'prior_founding',
    label: 'Founded before',
    weight: 6,
    detect(t) { return firstMatch(t, /\b(serial (founder|entrepreneur)|repeat founder|second[- ]time founder|third[- ]time founder|previously (co[- ]?)?founded|prior(ly)? founded|founded [a-z0-9][\w .&-]{1,40} \((19|20)\d{2}\))\b/i); },
  },
  {
    key: 'hyperscale',
    label: 'Hyperscaler background',
    weight: 6,
    // EMPLOYMENT, not a mention. Structured experiences[] first (ground truth); only
    // then free text, and only with an employment cue beside the company name.
    structured: true,
    detect(t, ctx = {}) {
      // 1) Real employment history. A hyperscaler in experiences[].company is a fact.
      for (const emp of ctx.employers || []) {
        const lc = normText(emp.company);
        for (const co of HYPERSCALERS) {
          // Whole-company match, not substring: "Amazon" must be the employer, not
          // "Amazon Web Services Partner Co" — reWord on the normalized company name.
          if (reWord(co).test(lc)) {
            const title = emp.title ? `${emp.title} at ${emp.company}` : emp.company;
            return { quote: title, label: `Hyperscaler: ${cap(co)}`, structured: true };
          }
        }
      }
      // 2) No structured history — demand an employment cue in the prose.
      for (const co of HYPERSCALERS) {
        const phrase = employedAtInText(co, t);
        if (phrase) return { quote: phrase, label: `Hyperscaler: ${cap(co)}` };
      }
      return null;
    },
  },
  {
    key: 'il_elite_school',
    label: 'Elite Illinois school',
    weight: 5,
    // A MODIFIER, not a qualifier. Danny: "they went to a prestigious Chicago/IL
    // school AND have a track record that lends itself to building outliers." The
    // school boosts priority but never makes the shortlist on its own — a degree is
    // not a track record. meetWorthy requires a core marker; this isn't one.
    modifier: true,
    structured: true,
    detect(t, ctx = {}) {
      // Structured education[] first — the same discipline as employment. "AI for
      // Northwestern students" or "based near the University of Chicago" is a
      // mention, not an alma mater; the education array never contains those.
      for (const school of ctx.schools || []) {
        const lc = normText(school);
        for (const s of IL_ELITE_SCHOOLS) {
          if (lc.includes(normText(s))) return { quote: school, label: cap(s), structured: true };
        }
      }
      // Free-text fallback: require an education cue near the school name.
      const eduCue = /\b(studied|degree|b\.?s\.?|m\.?s\.?|ph\.?d|mba|bachelor|master|alum|alumni|graduate|grad|class of|attended|educated)\b/i;
      for (const s of IL_ELITE_SCHOOLS) {
        const re = new RegExp(`(?:${s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')})`, 'i');
        const m = t.match(re);
        if (m) {
          const idx = m.index || 0;
          const window = t.slice(Math.max(0, idx - 60), idx + s.length + 40);
          if (eduCue.test(window)) return { quote: m[0], label: cap(s) };
        }
      }
      return null;
    },
  },
];

// A marker's evidence must be verbatim in the profile text (whitespace/punct
// normalized). Same gate the pedigree/tie checks use — nothing appears without a
// receipt that's actually in the source.
function verbatimIn(quote, text) {
  const q = normText(quote), t = normText(text);
  if (!q || q.length < 2) return false;
  if (t.includes(q)) return true;
  const words = q.split(' ');
  if (words.length >= 6) {
    const mid = words.slice(1, -1).join(' ');
    return mid.length >= 10 && t.includes(mid);
  }
  return false;
}

function markersFor(row) {
  const text = profileText(row);
  const ctx = structuredProfile(row);
  const out = [];
  for (const m of MARKERS) {
    const hit = m.detect(text, ctx);
    if (!hit) continue;
    const quote = typeof hit === 'string' ? hit : hit.quote;
    const label = typeof hit === 'string' ? m.label : (hit.label || m.label);
    // A structured hit's evidence comes from the LinkedIn experiences[]/education[]
    // arrays — ground truth that need not appear in the flattened prose blob, and
    // often won't (the array is separate from the bio). Only free-text hits face the
    // verbatim gate, which is exactly where invention is possible.
    const isStructured = typeof hit === 'object' && hit.structured;
    if (!isStructured && !verbatimIn(quote, text)) continue; // the receipt has to be real
    out.push({ key: m.key, label, weight: m.weight, evidence: quote, modifier: !!m.modifier, structured: !!isStructured });
  }
  // Strongest first, so "Why they're here" leads with the best reason.
  out.sort((a, b) => b.weight - a.weight);
  return { markers: out, text };
}

// ══════════════════════════════════════════════════════════════════════════
// THE VERDICT — gates + score, in one call.
//
//   meetWorthy  = earliest-stage (not past it) AND at least one outlier marker.
//                 This is the shortlist: who Danny should actually meet.
//   priority    = sum of marker weights, with a hard cut to 0 when the stage gate
//                 fails, so a strong-but-too-late founder can never outrank a
//                 genuinely early one. That is the ranking he asked for.
//   why         = the surviving marker labels — the honest "Why they're here".
// ══════════════════════════════════════════════════════════════════════════
function evaluate(row) {
  const { markers, text } = markersFor(row);
  const stage = classifyStage(text);
  const markerScore = markers.reduce((s, m) => s + m.weight, 0);

  // The shortlist needs a CORE marker, not just a modifier. A founder whose only
  // signal is "went to Northwestern" is not someone Danny asked to meet — he asked
  // for a school PLUS a track record. Core markers are the track record.
  const coreMarkers = markers.filter((m) => !m.modifier);
  const meetWorthy = !stage.tooLate && coreMarkers.length > 0;
  // Past-earliest founders keep a residual score (so the board can still show them,
  // sorted below), but they can never sit among the earliest-stage names Danny is
  // hunting for. Multiply, don't zero, so ranking within the excluded set is stable.
  const priority = stage.tooLate ? Math.round(markerScore * 0.1) : markerScore;

  return {
    meetWorthy,
    priority,
    stage: stage.stage,
    stageTooLate: stage.tooLate,
    stageEvidence: stage.evidence,
    markers,
    coreMarkerCount: coreMarkers.length,
    why: markers.map((m) => m.label),
    markerScore,
  };
}

module.exports = {
  evaluate, markersFor, classifyStage, profileText, verbatimIn,
  MARKERS, HYPERSCALERS, IL_ELITE_SCHOOLS,
};
