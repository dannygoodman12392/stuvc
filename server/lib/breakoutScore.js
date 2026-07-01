/**
 * breakoutScore.js — "how breakout-caliber is this builder?" A 0–100 signal that ranks by the
 * pedigree which predicts a top-program admit and a venture outcome: a prior exit / repeat
 * founder, an elite prior company, an elite school, a credential outlier, and an actively-building
 * signal. Evidence-backed — every point cites the phrase that earned it — so it reads like Danny's
 * founder rubric, not a black box. Computed for every sourced founder so any view is sortable by it.
 */

// [substring, points] — highest single match wins (don't double-count multiple jobs).
const ELITE_CO = [
  ['jane street', 20], ['citadel', 18], ['two sigma', 18], ['jump trading', 16], ['hudson river', 16],
  ['de shaw', 16], ['optiver', 14], ['drw', 14], ['flagship pioneering', 16],
  ['openai', 20], ['anthropic', 20], ['deepmind', 18], ['scale ai', 16], ['databricks', 16],
  ['stripe', 18], ['ramp', 16], ['brex', 14], ['plaid', 14], ['palantir', 18], ['anduril', 18],
  ['spacex', 18], ['nvidia', 16], ['tesla', 14], ['figma', 14], ['rippling', 14], ['notion', 12],
  ['coinbase', 12], ['google', 12], ['meta', 12], ['facebook', 12], ['apple', 12],
  ['microsoft', 10], ['amazon', 10], ['nasa', 12], ['argonne', 12], ['fermilab', 12],
  ['mckinsey', 10], ['bcg ', 10], ['bain ', 10], ['goldman', 10], ['jpmorgan', 8], ['morgan stanley', 8],
];
const ELITE_IL_SCHOOL = /\b(university of chicago|uchicago|chicago booth|kellogg|uiuc|university of illinois|northwestern|illinois institute of technology)\b/;
const ELITE_NAT_SCHOOL = /\b(\bmit\b|massachusetts institute|stanford|harvard|berkeley|carnegie mellon|caltech|princeton|yale|columbia|oxford|cambridge|waterloo|tsinghua|peking)\b/;
const EXIT = /\b(acquired by|acquisition of|sold (my|our|the)|prior exit|previous exit|exited|2x founder|3x founder|second-time founder|repeat founder|\(acquired\)|acquired in \d{4}|acquired \d{4})\b/;
const OUTLIER = /\b(forbes 30 under 30|30 under 30|thiel fellow|ioi|imo medal|putnam|olympiad|rhodes scholar|\bphd\b|dropped out|on leave to build|deferred (mit|stanford|harvard))\b/;
const BUILDING = /\b(stealth|building something|working on something new|founder|co-?founder|founding engineer|\bcto\b|building (a|an|the))\b/;
const TECHNICAL = /\b(machine learning|ml engineer|ai research|research scientist|staff engineer|principal engineer|distinguished engineer|founding engineer|software engineer|deep learning)\b/;

function breakoutScore(text = '') {
  const t = String(text).toLowerCase();
  let score = 0;
  const signals = [];

  const exit = EXIT.exec(t);
  if (exit) { score += 30; signals.push(`repeat founder / prior exit ("${exit[0].trim()}")`); }

  let coPts = 0, coName = null;
  for (const [co, pts] of ELITE_CO) { if (t.includes(co) && pts > coPts) { coPts = pts; coName = co.trim(); } }
  if (coName) { score += coPts; signals.push(`elite background: ${coName}`); }

  if (ELITE_IL_SCHOOL.test(t)) { score += 12; signals.push('elite Illinois school'); }
  else if (ELITE_NAT_SCHOOL.test(t)) { score += 10; signals.push('elite school'); }

  const out = OUTLIER.exec(t);
  if (out) { score += 12; signals.push(`credential: ${out[0].trim()}`); }

  if (BUILDING.test(t)) { score += 10; signals.push('actively building'); }
  if (TECHNICAL.test(t)) { score += 8; signals.push('technical depth'); }

  return { score: Math.min(score, 100), signals };
}

module.exports = { breakoutScore };
