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
    detect(t) {
      const lc = normText(t);
      for (const co of HYPERSCALERS) {
        if (reWord(co).test(lc)) {
          // Prefer to show a senior/departure phrasing if present, else the company.
          const senior = firstMatch(t, new RegExp(`\\b(staff|principal|lead|senior|head of|vp|director|founding)\\b[^.]{0,30}\\b${co}\\b`, 'i'))
            || firstMatch(t, new RegExp(`\\b${co}\\b[^.]{0,30}\\b(staff|principal|lead|senior|head of|vp|director)\\b`, 'i'));
          return { quote: senior || co, label: `Hyperscaler: ${co.replace(/\b\w/g, (c) => c.toUpperCase())}` };
        }
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
    detect(t) {
      const lc = normText(t);
      for (const s of IL_ELITE_SCHOOLS) {
        if (lc.includes(normText(s))) return { quote: s, label: `${s.replace(/\b\w/g, (c) => c.toUpperCase())}` };
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
  const out = [];
  for (const m of MARKERS) {
    const hit = m.detect(text);
    if (!hit) continue;
    const quote = typeof hit === 'string' ? hit : hit.quote;
    const label = typeof hit === 'string' ? m.label : (hit.label || m.label);
    if (!verbatimIn(quote, text)) continue; // the receipt has to be real
    out.push({ key: m.key, label, weight: m.weight, evidence: quote, modifier: !!m.modifier });
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
