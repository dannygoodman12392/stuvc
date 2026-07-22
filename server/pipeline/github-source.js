'use strict';
// ══════════════════════════════════════════════════════════════════════════
// GitHub-native builder sourcing — the elegant inversion.
//
// Danny asked for "the most elegant way to identify and prioritize the kind of
// founder I need to see." The old approach sourced from LinkedIn (self-presentation)
// and tried to bolt slope on by resolving handles — backwards, and lossy at the join.
//
// This sources from the BUILDER GRAPH directly. GitHub is where building is visible.
// Query it for Illinois-located users, rank by SLOPE (velocity + inflection), keep
// only those who are actually building something — and slope becomes the front door,
// not an afterthought. The illegible UIUC builder with an accelerating repo and no
// résumé shows up here natively; the tenured professor with old fame does not,
// because slope measures the derivative, not the altitude.
//
// THREE GATES, in cost order (cheapest first, so we pay for slope only on real ties):
//   1. IL TIE — verifyIlTie on the profile's location/bio/company. Danny's hard rule:
//      a verified Illinois tie, never a guess. GitHub location is self-reported, so
//      this also throws out "earth" / "the cloud" / "remote".
//   2. BUILDING — a founder/building signal in the bio, OR a recent inflection repo
//      (shipping something that's taking off IS building something new). This is what
//      separates the pre-seed founder from the employed engineer with the same stars.
//   3. SLOPE — a real trajectory (≥ 5). The whole point.
// ══════════════════════════════════════════════════════════════════════════

const https = require('https');
const db = require('../db');
const { computeGithubSlope } = require('./github-activity');
const { verifyIlTie } = require('../lib/ilTie');

function ghGet(path, token) {
  return new Promise((resolve) => {
    const req = https.request({
      hostname: 'api.github.com', path, method: 'GET',
      headers: {
        'User-Agent': 'stu-sourcing', 'Accept': 'application/vnd.github+json',
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
      },
    }, (res) => {
      let b = '';
      res.on('data', (d) => (b += d));
      res.on('end', () => { try { resolve({ status: res.statusCode, data: JSON.parse(b) }); } catch { resolve({ status: res.statusCode, data: null }); } });
    });
    req.on('error', () => resolve({ status: 0, data: null }));
    req.end();
  });
}

// IL location queries — the common self-reported spellings. type:user excludes orgs.
const IL_QUERIES = [
  'location:Chicago', 'location:Illinois', 'location:Evanston',
  'location:Champaign', 'location:Urbana', 'location:Naperville', 'location:"Chicago, IL"',
];

// A founder/building signal in the bio. Not required if a recent repo is taking off.
const BUILDING_RE = /\b(found(er|ing|ed)|co-?found|building|stealth|working on|\bceo\b|\bcto\b|launch(ed|ing)?|shipping|indie ?hacker|0 ?to ?1|prev(iously)? founded|ex-founder|building something)\b/i;

const gh = (login) => `https://github.com/${login}`;

// Clean GitHub's free-text company field into something card-worthy, or null.
function cleanCompany(c) {
  if (!c) return null;
  const s = String(c).replace(/@/g, '').split(/[,/|]/)[0].trim();
  return s && s.length <= 40 ? s : null;
}

// Assess one candidate login. Returns an insert-ready row, or null with a reason.
async function assess(login, token) {
  const p = (await ghGet(`/users/${login}`, token)).data;
  if (!p || !p.login) return { skip: 'no profile' };

  // Gate 1 — verified IL tie (cheap, no extra API cost beyond the profile we have).
  const tieText = [p.location, p.bio, p.company, p.name].filter(Boolean).join(' • ');
  const tie = verifyIlTie(tieText);
  if (!tie.verified) return { skip: 'no verified IL tie' };

  // Gate 3 (compute now; we need slope for both the building gate and the score).
  const slope = await computeGithubSlope(gh(login), token);
  const s = slope ? slope.slope_score : 0;

  // Gate 2 — actually building. Bio says founder/building, OR a repo is inflecting.
  const building = BUILDING_RE.test(p.bio || '') || !!(slope && slope.data && slope.data.inflection);
  if (!building) return { skip: 'no building signal' };
  if (s < 5) return { skip: `slope ${s} < 5` };

  return {
    row: {
      name: p.name || p.login,
      company: cleanCompany(p.company),
      headline: (p.bio || '').slice(0, 300),
      github_url: gh(login),
      website_url: p.blog || null,
      location_city: tie.place || p.location || null,
      location_type: tie.type,                 // one of VALID_TIE_TYPES
      chicago_connection: `${p.location || tie.place}${p.bio ? ` — ${p.bio.slice(0, 80)}` : ''}`,
      github_slope_score: s,
      github_slope_data: JSON.stringify({ ...slope.data, evidence: slope.evidence }),
      source: 'github_builders',
    },
    slope: s,
    evidence: slope.evidence,
  };
}

// Already in the pool or the pipeline? Dedup on github_url first, then name.
function isDuplicate(row, userId) {
  const byGh = db.prepare('SELECT 1 FROM sourced_founders WHERE user_id = ? AND github_url = ? LIMIT 1').get(userId, row.github_url)
    || db.prepare('SELECT 1 FROM founders WHERE created_by = ? AND is_deleted = 0 AND github_url = ? LIMIT 1').get(userId, row.github_url);
  if (byGh) return true;
  if (row.name && row.name.length >= 4) {
    const byName = db.prepare('SELECT 1 FROM sourced_founders WHERE user_id = ? AND LOWER(name) = LOWER(?) LIMIT 1').get(userId, row.name)
      || db.prepare('SELECT 1 FROM founders WHERE created_by = ? AND is_deleted = 0 AND LOWER(name) = LOWER(?) LIMIT 1').get(userId, row.name);
    if (byName) return true;
  }
  return false;
}

const INSERT = `
  INSERT INTO sourced_founders
    (name, company, headline, github_url, website_url, location_city, location_type,
     chicago_connection, github_slope_score, github_slope_data, source, status,
     list_scope, confidence_score, user_id, signal_captured_at)
  VALUES (@name, @company, @headline, @github_url, @website_url, @location_city, @location_type,
     @chicago_connection, @github_slope_score, @github_slope_data, @source, 'pending',
     'pipeline', @confidence_score, @user_id, CURRENT_TIMESTAMP)
`;

// Main entry. Sweeps IL location queries, assesses candidates, inserts the builders.
// candidatesPerQuery bounds API spend; the search API is 30 req/min authed and each
// kept candidate costs ~3 calls (search page is shared, profile + 2 slope calls).
async function discoverGithubBuilders({ userId = 1, token, candidatesPerQuery = 15, pages = 1 } = {}) {
  const out = { considered: 0, added: 0, skipped: {}, examples: [] };
  const seen = new Set();
  const ins = db.prepare(INSERT);

  for (const q of IL_QUERIES) {
    for (let page = 1; page <= pages; page++) {
      const r = await ghGet(`/search/users?q=${encodeURIComponent(q + ' type:user')}&sort=followers&order=desc&per_page=${candidatesPerQuery}&page=${page}`, token);
      const items = (r.data && r.data.items) || [];
      for (const u of items) {
        if (seen.has(u.login)) continue;
        seen.add(u.login);
        out.considered++;
        let a;
        try { a = await assess(u.login, token); } catch (e) { out.skipped[e.message] = (out.skipped[e.message] || 0) + 1; continue; }
        if (!a || a.skip) { const k = (a && a.skip) || 'error'; out.skipped[k] = (out.skipped[k] || 0) + 1; continue; }
        if (isDuplicate(a.row, userId)) { out.skipped.duplicate = (out.skipped.duplicate || 0) + 1; continue; }
        ins.run({ ...a.row, confidence_score: Math.min(10, 5 + Math.floor(a.slope / 3)), user_id: userId });
        out.added++;
        if (out.examples.length < 15) out.examples.push(`${a.row.name} (slope ${a.slope}) — ${a.evidence || a.row.chicago_connection}`);
        await new Promise((res) => setTimeout(res, 250)); // polite between profile+slope bursts
      }
      await new Promise((res) => setTimeout(res, 1200)); // between search pages (search RL is tighter)
    }
  }
  return out;
}

module.exports = { discoverGithubBuilders, assess, __test: { cleanCompany, BUILDING_RE } };
