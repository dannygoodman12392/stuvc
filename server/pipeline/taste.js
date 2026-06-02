/**
 * Taste profile — the sourcing learning loop.
 * ===========================================
 * Danny's own actions are the training signal: founders he APPROVES (adds to pipeline)
 * or STARS are "liked"; founders he DISMISSES are "passed." We compare the signals of
 * liked vs passed founders to learn which attributes predict his taste, then feed that
 * back as (a) a calibration block in the scoring prompt and (b) an "affinity" re-rank.
 *
 * Hard rules (Chicago/IL tie, founders-only, red-flag clamps) are NEVER overridden —
 * affinity only nudges ordering among already-qualified founders.
 */
const db = require('../db');

function parseArr(s) { try { const v = JSON.parse(s || '[]'); return Array.isArray(v) ? v : []; } catch { return []; } }

// Canonical signal tokens for a founder row (namespaced so domains/pedigree/etc. don't collide).
function rowSignals(r) {
  const sig = new Set();
  for (const t of parseArr(r.tags)) sig.add('domain:' + String(t).toLowerCase());
  for (const p of parseArr(r.pedigree_signals)) sig.add('ped:' + String(p).toLowerCase());
  for (const b of parseArr(r.builder_signals)) sig.add('bld:' + String(b).toLowerCase());
  for (const c of parseArr(r.caliber_signals)) sig.add('cal:' + String(c).toLowerCase());
  if (r.location_type) sig.add('tie:' + String(r.location_type).toLowerCase());
  if (r.caliber_tier) sig.add('tier:' + String(r.caliber_tier));
  return [...sig];
}

const COLS = 'tags, pedigree_signals, builder_signals, caliber_signals, location_type, caliber_tier';
const MIN_LIKED = 3; // need a little history before we trust the signal

function computeTasteProfile(userId) {
  const liked = db.prepare(`SELECT ${COLS} FROM sourced_founders WHERE user_id = ? AND status IN ('approved','starred')`).all(userId);
  const passed = db.prepare(`SELECT ${COLS} FROM sourced_founders WHERE user_id = ? AND status = 'dismissed'`).all(userId);
  const likedN = liked.length, passedN = passed.length;
  const empty = { likedN, passedN, favored: [], disfavored: [], weights: {}, promptText: '' };
  if (likedN < MIN_LIKED) return empty;

  const freq = (rows) => { const m = {}; for (const r of rows) for (const s of rowSignals(r)) m[s] = (m[s] || 0) + 1; return m; };
  const lf = freq(liked), pf = freq(passed);
  const keys = new Set([...Object.keys(lf), ...Object.keys(pf)]);

  const weights = {};
  const scored = [];
  for (const k of keys) {
    const support = (lf[k] || 0) + (pf[k] || 0);
    if (support < 2) continue; // ignore one-off noise
    const lift = (lf[k] || 0) / likedN - (pf[k] || 0) / Math.max(1, passedN); // + favored, - disfavored
    weights[k] = lift;
    scored.push([k, lift]);
  }
  scored.sort((a, b) => b[1] - a[1]);
  const favored = scored.filter(x => x[1] > 0.12).slice(0, 8).map(x => x[0]);
  const disfavored = scored.filter(x => x[1] < -0.12).map(x => x[0]).slice(-8);

  const label = (k) => k.replace(/^(domain|ped|bld|cal|tie|tier):/, '');
  const fav = favored.map(label).join(', ');
  const dis = disfavored.map(label).join(', ');
  const promptText = fav || dis
    ? `\n\nLEARNED PREFERENCES — Danny has approved ${likedN} founders and passed on ${passedN}.${fav ? ` He tends to FAVOR: ${fav}.` : ''}${dis ? ` He tends to PASS on: ${dis}.` : ''} Nudge the fit score up for favored patterns and down for disfavored ones — but NEVER override the hard rules (verified Chicago/IL tie required, founders only, red-flag clamps).`
    : '';

  return { likedN, passedN, favored, disfavored, weights, promptText };
}

// Affinity for a founder given the learned weights. Returns -5..+5 and the matched signals.
function scoreAffinity(signalRow, weights) {
  if (!weights || Object.keys(weights).length === 0) return { affinity: 0, hits: [] };
  let s = 0; const hits = [];
  for (const sig of rowSignals(signalRow)) {
    const w = weights[sig];
    if (typeof w === 'number') { s += w; if (w > 0.12) hits.push(sig.replace(/^(domain|ped|bld|cal|tie|tier):/, '')); }
  }
  const affinity = Math.max(-5, Math.min(5, Math.round(s * 10)));
  return { affinity, hits: hits.slice(0, 4) };
}

module.exports = { computeTasteProfile, scoreAffinity, rowSignals };
