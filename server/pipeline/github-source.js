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

const db = require('../db');
const { computeGithubSlope } = require('./github-activity');
const { verifyIlTie } = require('../lib/ilTie');
const { ghGet } = require('../lib/githubClient'); // shared client with rate-limit backoff

// IL location queries — the common self-reported spellings + university towns and the
// schools themselves (which many students/researchers put as their location). type:user
// excludes orgs. Free; each is one search call, and the shared client backs off if the
// search rate window tightens. verifyIlTie is the real gate, so a loose query is safe —
// it just widens the funnel that the tie check then narrows.
const IL_QUERIES = [
  'location:Chicago', 'location:Illinois', 'location:"Chicago, IL"',
  'location:Evanston', 'location:Champaign', 'location:Urbana', 'location:Naperville',
  'location:Schaumburg', 'location:Peoria', 'location:Springfield+location:Illinois',
  'location:UIUC', 'location:"University of Illinois"', 'location:Northwestern',
  'location:"University of Chicago"',
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

// AUGMENT, DON'T SKIP. Danny: "Whatever you build needs to augment/complement the
// LinkedIn scraping... I need ONE prioritized list of the top builders." A founder
// who is BOTH a rich LinkedIn profile AND a fast GitHub builder is the strongest row
// on the board — but the old dedup just skipped the GitHub insert and threw the slope
// away. So instead: if the person already exists, MERGE the slope onto their record.
// Returns 'merged' (augmented an existing row), 'exists' (already had slope), or
// null (genuinely new — caller inserts).
function mergeIfExists(row, userId) {
  const findSourced = db.prepare(
    'SELECT id, github_url, github_slope_score FROM sourced_founders WHERE user_id = ? AND (github_url = ? OR (LENGTH(name) >= 4 AND LOWER(name) = LOWER(?))) LIMIT 1'
  ).get(userId, row.github_url, row.name);
  const findFounder = db.prepare(
    'SELECT id, github_url, github_slope_score FROM founders WHERE created_by = ? AND is_deleted = 0 AND (github_url = ? OR (LENGTH(name) >= 4 AND LOWER(name) = LOWER(?))) LIMIT 1'
  ).get(userId, row.github_url, row.name);

  // On the live pipeline already — augment the founder card so the same slope shows
  // wherever the person is, and stop (don't also add a duplicate inbox row).
  if (findFounder) {
    if (findFounder.github_slope_score == null) {
      db.prepare('UPDATE founders SET github_url = COALESCE(github_url, ?), github_slope_score = ?, github_slope_data = ? WHERE id = ?')
        .run(row.github_url, row.github_slope_score, row.github_slope_data, findFounder.id);
      return 'merged';
    }
    return 'exists';
  }
  if (findSourced) {
    if (findSourced.github_slope_score == null) {
      db.prepare('UPDATE sourced_founders SET github_url = COALESCE(github_url, ?), github_slope_score = ?, github_slope_data = ? WHERE id = ?')
        .run(row.github_url, row.github_slope_score, row.github_slope_data, findSourced.id);
      return 'merged';
    }
    return 'exists';
  }
  return null;
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
  const out = { considered: 0, added: 0, merged: 0, skipped: {}, examples: [] };
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
        // If the person is already known (LinkedIn pool or the live pipeline), AUGMENT
        // that record with the slope instead of adding a second row — one prioritized
        // list, and the founder-on-both becomes the strongest row on it.
        const merged = mergeIfExists(a.row, userId);
        if (merged === 'merged') { out.merged = (out.merged || 0) + 1; if (out.examples.length < 15) out.examples.push(`↳ merged slope ${a.slope} onto existing ${a.row.name}`); continue; }
        if (merged === 'exists') { out.skipped.already_had_slope = (out.skipped.already_had_slope || 0) + 1; continue; }
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

// ── SAFE BACKFILL — GitHub links already in the LinkedIn scrape ──
// The zero-risk half of the augmentation: many technical founders already link their
// GitHub in their profile/bio. Extract those (no fuzzy name-matching, no false
// positives) and set github_url, so the LinkedIn pool earns slope on the next refresh
// too — the two fronts converging on one record without guessing anyone's identity.
const GH_LINK = /github\.com\/([a-zA-Z0-9](?:[a-zA-Z0-9-]{0,38})?)(?![a-zA-Z0-9-])/i;
const GH_RESERVED = /^(orgs?|about|features|pricing|marketplace|topics|sponsors|readme|explore|login|join|settings|apps|customer-stories|enterprise|team|collections|trending|search|notifications|new|dashboard)$/i;
// Well-known ORG handles. A link to "github.com/facebook/react" is a contribution
// or a mention, not the founder's own account — attaching it would give a stranger's
// slope to the wrong person, the exact hallucination class to avoid.
const GH_ORG = /^(facebook|google|microsoft|apple|amazon|aws|netflix|meta|openai|anthropic|vercel|nodejs|kubernetes|tensorflow|pytorch|angular|reactjs|vuejs|golang|rust-lang|apache|nvidia|huggingface|langchain-ai|stripe|shopify|airbnb|uber|twitter|x|spotify)$/i;

function backfillGithubFromScrape({ userId = 1, limit = 2000 } = {}) {
  const rows = db.prepare(`
    SELECT id, raw_data, enriched_data, linkedin_data, headline FROM sourced_founders
    WHERE user_id = ? AND status IN ('pending','starred') AND (github_url IS NULL OR github_url = '')
    LIMIT ?
  `).all(userId, limit);
  const upd = db.prepare("UPDATE sourced_founders SET github_url = ? WHERE id = ?");
  let set = 0;
  for (const r of rows) {
    const blob = [r.raw_data, r.enriched_data, r.linkedin_data, r.headline].filter(Boolean).join(' ');
    const m = blob.match(GH_LINK);
    if (m && !GH_RESERVED.test(m[1]) && !GH_ORG.test(m[1])) { upd.run(`https://github.com/${m[1]}`, r.id); set++; }
  }
  return { scanned: rows.length, github_url_set: set };
}

module.exports = { discoverGithubBuilders, backfillGithubFromScrape, assess, __test: { cleanCompany, BUILDING_RE, GH_LINK, GH_RESERVED, GH_ORG } };
