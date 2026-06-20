/**
 * builderSignals.js — the filterable "unicorn builder" signal taxonomy.
 *
 * A small set of high-signal profile *states* that identify exceptional builders the
 * moment they become reachable. "YC founder just left" is one type among several. The
 * same taxonomy powers BOTH products:
 *   - Sourcing (founders): who just became foundable — catch them before they declare.
 *   - Talent (hiring):     who just became hireable into a portfolio rocket ship.
 *
 * Each signal is a pure detector over a normalized profile, returning {matched,
 * confidence, evidence}. They're used three ways: as a filter on Talent/Sourcing
 * search, as MCP tool params, and (Phase 3) as the trigger of a background monitor.
 *
 * Detectors are heuristic and evidence-bearing by design — they never assert without
 * citing the substring/field that fired, so a human (or the LLM scorer downstream)
 * can audit every hit.
 */

// ── Company tiers (lowercased substrings; matched against company / history text) ──

// "Founder factories": breakouts whose early employees are the next founders / elite hires.
const UNICORN_FACTORIES = [
  'openai', 'anthropic', 'stripe', 'ramp', 'brex', 'plaid', 'scale ai', 'scale',
  'databricks', 'snowflake', 'figma', 'notion', 'linear', 'vercel', 'retool',
  'rippling', 'airtable', 'palantir', 'spacex', 'anduril', 'coinbase', 'robinhood',
  'datadog', 'cloudflare', 'nvidia', 'tesla', 'ramp', 'mistral', 'perplexity',
  'cursor', 'anysphere', 'deel', 'mercury', 'gusto', 'instacart', 'doordash', 'uber',
  'airbnb', 'square', 'block', 'twitch', 'discord', 'canva', 'wiz',
];

// Accelerator / fellowship markers (text-matched; not company names).
const ACCELERATOR_MARKERS = [
  'y combinator', 'ycombinator', 'yc s2', 'yc w2', 'yc x2', '(yc', 'yc alum',
  'south park commons', 'spc', 'entrepreneur first', 'on deck', 'techstars',
  'thiel fellow', 'z fellows', 'zfellows', 'neo scholar', 'founders inc',
  'a16z speedrun', 'a16z speed run', 'speedrun (a16z)', 'andreessen speedrun',
];

// Elite credential markers (raw-talent outliers).
const OUTLIER_MARKERS = [
  'thiel fellow', 'forbes 30 under 30', '30 under 30', 'ioi medal', 'imo medal',
  'putnam', 'acm icpc', 'world finals', 'phd', 'd.phil', 'rhodes scholar',
  'research scientist', 'staff research', 'distinguished engineer',
];

// "Building something new" / stealth markers.
const STEALTH_MARKERS = [
  'stealth', 'building something new', 'something new', 'founder mode',
  'building the future', 'tbd', 'to be announced', 'new co', 'newco', '0 to 1', '0->1',
  'working on something', 'figuring out what', 'on a sabbatical to build',
];

// Repeat-founder markers.
const REPEAT_FOUNDER_MARKERS = [
  'second-time founder', 'second time founder', 'repeat founder', 'serial founder',
  'previous exit', 'prior exit', 'acquired by', 'exited founder', 'ex-founder',
  'sold my', 'sold our', 'founder (acquired)', '2x founder', '3x founder',
];

// Early-employee / founding-team markers.
const FOUNDING_TEAM_MARKERS = [
  'founding engineer', 'founding member', 'first engineer', 'employee #', 'employee no',
  'first 10', 'first 20', 'early engineer', 'early employee', 'founding team',
  'first engineering hire', '#1 engineer', 'early team',
];

// Build-velocity markers.
const BREAKOUT_MARKERS = [
  'open source', 'oss maintainer', 'maintainer of', 'creator of', 'author of',
  'build in public', 'building in public', 'indie hacker', 'shipped', 'trending on github',
];

function hasAny(text, markers) {
  const hits = [];
  for (const m of markers) if (text.includes(m)) hits.push(m);
  return hits;
}

// ── Normalize either a sourced_founders row or a talent_candidates row ──
// Tolerates missing fields; produces a common shape + a lowercased text blob.
function normalizeProfile(row = {}, source = 'sourcing') {
  const parseArr = (v) => {
    if (Array.isArray(v)) return v;
    if (typeof v !== 'string' || !v) return [];
    try { const p = JSON.parse(v); return Array.isArray(p) ? p : [String(p)]; } catch { return [v]; }
  };
  const signals = [
    ...parseArr(row.pedigree_signals),
    ...parseArr(row.builder_signals),
    ...parseArr(row.leap_signals),
    ...parseArr(row.caliber_signals),
    ...parseArr(row.tags),
  ];
  const company = row.current_company || row.company || '';
  const role = row.current_role || row.role || row.headline || '';
  const textParts = [
    row.headline, row.bio, role, company, row.notable_background,
    row.previous_companies, row.previous_company_norm, row.chicago_connection,
    row.one_liner, row.score_rationale, ...signals,
  ].filter(Boolean).map(String);
  return {
    source,
    name: row.name || '',
    company,
    role,
    githubUrl: row.github_url || '',
    githubActivity: row.github_activity_score ?? null,
    tenureMonths: row.tenure_months ?? null,
    departureRecencyMonths: row.departure_recency_months ?? null,
    signals,
    text: textParts.join(' • ').toLowerCase(),
  };
}

function companyTierHit(profile, tierList) {
  return hasAny(profile.text, tierList);
}

// ── The signal taxonomy ──
// detect(profile, opts) -> { matched, confidence (0-1), evidence: string[] }

const SIGNALS = [
  {
    key: 'just_departed',
    label: 'Just departed a notable company',
    appliesTo: ['sourcing', 'talent'],
    description:
      'Recently left their company — the highest-signal moment to reach a builder, before they have declared what is next. Optional company filter (e.g. YC, a unicorn factory).',
    // opts: { maxMonths=9, fromTier='any'|'yc'|'factory' }
    detect(p, opts = {}) {
      const maxMonths = opts.maxMonths ?? 9;
      const evidence = [];
      let recencyOk = false;
      if (p.departureRecencyMonths != null) {
        recencyOk = p.departureRecencyMonths <= maxMonths;
        if (recencyOk) evidence.push(`left ~${p.departureRecencyMonths}mo ago`);
      } else {
        // Fall back to textual "just left / recently left / ex-/former" cues.
        const cues = hasAny(p.text, ['just left', 'recently left', 'departed', 'former ', 'ex-', 'until recently', 'most recently']);
        recencyOk = cues.length > 0;
        evidence.push(...cues.map(c => `cue: "${c}"`));
      }
      if (!recencyOk) return { matched: false, confidence: 0, evidence: [] };

      const tier = opts.fromTier || 'any';
      if (tier === 'yc') {
        const yc = hasAny(p.text, ACCELERATOR_MARKERS).filter(m => m.includes('yc') || m.includes('combinator'));
        if (!yc.length) return { matched: false, confidence: 0, evidence: [] };
        evidence.push(`YC: ${yc.join(', ')}`);
      } else if (tier === 'factory') {
        const f = companyTierHit(p, UNICORN_FACTORIES);
        if (!f.length) return { matched: false, confidence: 0, evidence: [] };
        evidence.push(`factory: ${f.join(', ')}`);
      }
      // Confidence: structured recency is stronger than textual cues; tier filter adds signal.
      let c = p.departureRecencyMonths != null ? 0.7 : 0.45;
      if (tier !== 'any') c += 0.2;
      return { matched: true, confidence: Math.min(c, 0.95), evidence };
    },
  },
  {
    key: 'stealth_building',
    label: 'Stealth / building something new',
    appliesTo: ['sourcing', 'talent'],
    description: 'Bio or title signals a new venture in progress: "stealth", "building something new", employer removed.',
    detect(p) {
      const hits = hasAny(p.text, STEALTH_MARKERS);
      if (!hits.length) return { matched: false, confidence: 0, evidence: [] };
      return { matched: true, confidence: Math.min(0.5 + 0.1 * hits.length, 0.9), evidence: hits.map(h => `"${h}"`) };
    },
  },
  {
    key: 'founder_factory_alum',
    label: 'Early at a founder-factory company',
    appliesTo: ['sourcing', 'talent'],
    description:
      'Was an early/founding employee at a breakout (OpenAI, Stripe, Ramp, …). Often the next founder, or an elite early hire, before they have declared.',
    detect(p) {
      const factory = companyTierHit(p, UNICORN_FACTORIES);
      const early = hasAny(p.text, FOUNDING_TEAM_MARKERS);
      if (!factory.length || !early.length) return { matched: false, confidence: 0, evidence: [] };
      return {
        matched: true,
        confidence: 0.75,
        evidence: [`factory: ${factory.join(', ')}`, `early-role: ${early.join(', ')}`],
      };
    },
  },
  {
    key: 'repeat_founder',
    label: 'Repeat founder / prior exit',
    appliesTo: ['sourcing', 'talent'],
    description: 'Has founded before, often with an exit or acquisition — capitalized and pattern-aware on the second at-bat.',
    detect(p) {
      const hits = hasAny(p.text, REPEAT_FOUNDER_MARKERS);
      if (!hits.length) return { matched: false, confidence: 0, evidence: [] };
      return { matched: true, confidence: Math.min(0.6 + 0.1 * hits.length, 0.9), evidence: hits.map(h => `"${h}"`) };
    },
  },
  {
    key: 'breakout_builder',
    label: 'Breakout build velocity',
    appliesTo: ['sourcing', 'talent'],
    description: 'Raw building output: OSS maintainer/creator, build-in-public, strong GitHub activity.',
    detect(p) {
      const hits = hasAny(p.text, BREAKOUT_MARKERS);
      const ghStrong = p.githubActivity != null && p.githubActivity >= 6;
      if (!hits.length && !ghStrong) return { matched: false, confidence: 0, evidence: [] };
      const evidence = hits.map(h => `"${h}"`);
      if (ghStrong) evidence.push(`github activity ${p.githubActivity}/10`);
      return { matched: true, confidence: Math.min(0.45 + 0.12 * evidence.length, 0.9), evidence };
    },
  },
  {
    key: 'credentialed_outlier',
    label: 'Credentialed outlier',
    appliesTo: ['sourcing', 'talent'],
    description: 'Elite raw-talent markers: top PhD/researcher commercializing, Thiel Fellow, olympiad medalist, 30u30.',
    detect(p) {
      const hits = hasAny(p.text, OUTLIER_MARKERS);
      if (!hits.length) return { matched: false, confidence: 0, evidence: [] };
      return { matched: true, confidence: Math.min(0.5 + 0.12 * hits.length, 0.9), evidence: hits.map(h => `"${h}"`) };
    },
  },
  {
    key: 'fresh_incorporation',
    label: 'Fresh incorporation / formation signal',
    appliesTo: ['sourcing'],
    description:
      'Just incorporated: very short current tenure plus a formation/accelerator cue. The earliest possible founder signal (pairs with SEC Form D / entity filings).',
    detect(p) {
      const shortTenure = p.tenureMonths != null && p.tenureMonths <= 6;
      const cues = hasAny(p.text, ['founder', 'co-founder', 'cofounder', 'incorporated', 'just started', 'newly founded']);
      const accel = hasAny(p.text, ACCELERATOR_MARKERS);
      if (!(shortTenure && (cues.length || accel.length))) return { matched: false, confidence: 0, evidence: [] };
      const evidence = [`tenure ~${p.tenureMonths}mo`, ...cues.map(c => `"${c}"`), ...accel.map(a => `accel: ${a}`)];
      return { matched: true, confidence: accel.length ? 0.7 : 0.5, evidence };
    },
  },
];

const SIGNAL_BY_KEY = Object.fromEntries(SIGNALS.map(s => [s.key, s]));
const VALID_SIGNAL_KEYS = SIGNALS.map(s => s.key);

// Public catalog (safe to expose over the API/MCP — no detection internals).
function listSignals(product = null) {
  return SIGNALS
    .filter(s => !product || s.appliesTo.includes(product))
    .map(({ key, label, description, appliesTo }) => ({ key, label, description, appliesTo }));
}

// Run one or more detectors over a raw DB row. Returns the matched signals (with
// evidence) and the max confidence — used both to filter and to explain a hit.
function detectSignals(row, { types = VALID_SIGNAL_KEYS, source = 'sourcing', opts = {} } = {}) {
  const profile = normalizeProfile(row, source);
  const matched = [];
  for (const key of types) {
    const sig = SIGNAL_BY_KEY[key];
    if (!sig) continue;
    const r = sig.detect(profile, opts[key] || {});
    if (r.matched) matched.push({ key, label: sig.label, confidence: r.confidence, evidence: r.evidence });
  }
  matched.sort((a, b) => b.confidence - a.confidence);
  return { matched, topConfidence: matched.length ? matched[0].confidence : 0, profileText: profile.text };
}

// Filter a list of rows to those matching the requested signals.
//   mode 'any' (default): matches at least one requested signal.
//   mode 'all':           matches every requested signal.
function filterBySignals(rows, { types = VALID_SIGNAL_KEYS, source = 'sourcing', mode = 'any', minConfidence = 0, opts = {} } = {}) {
  const out = [];
  for (const row of rows) {
    const { matched } = detectSignals(row, { types, source, opts });
    const passing = matched.filter(m => m.confidence >= minConfidence);
    const ok = mode === 'all' ? types.every(t => passing.some(m => m.key === t)) : passing.length > 0;
    if (ok) out.push({ row, signals: passing });
  }
  return out;
}

module.exports = {
  SIGNALS,
  VALID_SIGNAL_KEYS,
  UNICORN_FACTORIES,
  listSignals,
  detectSignals,
  filterBySignals,
  normalizeProfile,
};
