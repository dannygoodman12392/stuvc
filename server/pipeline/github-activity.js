/**
 * R8 — GitHub activity depth scorer
 * =================================
 * For candidates with a github_url, pull recent activity and compute a 0-10
 * activity score + structured data blob.
 *
 * Signals weighted (higher = stronger pre-seed builder signal):
 *  - Events in last 30 days (commits, PRs, creates) — up to 4 pts
 *  - New org memberships in last 90 days — up to 2 pts
 *  - Public repos created in last 60 days — up to 3 pts
 *  - Public repo recently flipped private→public — +1 pt (leading indicator)
 *
 * Decay: score drops to 0 if zero activity in 90 days.
 */

const db = require('../db');
const { ghGet } = require('../lib/githubClient'); // shared client with rate-limit backoff

function ghLoginFromUrl(url) {
  if (!url) return null;
  const m = /github\.com\/([a-zA-Z0-9-]+)\/?$/.exec(url.replace(/\/$/, ''));
  return m ? m[1] : null;
}

async function computeGithubActivity(ghUrl, token) {
  const login = ghLoginFromUrl(ghUrl);
  if (!login) return null;

  const now = Date.now();
  const days = (ms) => (now - new Date(ms).getTime()) / (1000 * 60 * 60 * 24);

  // Events — recent activity signal
  const events = await ghGet(`/users/${login}/events/public?per_page=100`, token);
  if (events.status !== 200 || !Array.isArray(events.data)) return null;

  const recent30 = events.data.filter(e => days(e.created_at) <= 30);
  const commits = recent30.filter(e => e.type === 'PushEvent').length;
  const prs = recent30.filter(e => e.type === 'PullRequestEvent').length;
  const creates = recent30.filter(e => e.type === 'CreateEvent').length;
  const activity30 = commits + prs + creates;

  // Orgs
  const orgs = await ghGet(`/users/${login}/orgs`, token);
  const orgCount = Array.isArray(orgs.data) ? orgs.data.length : 0;

  // Repos — flag recent creation + flipped-public
  const repos = await ghGet(`/users/${login}/repos?sort=created&direction=desc&per_page=30`, token);
  let recentReposCreated = 0;
  let recentFlippedPublic = 0;
  if (Array.isArray(repos.data)) {
    for (const r of repos.data) {
      if (days(r.created_at) <= 60 && !r.fork) recentReposCreated++;
      // Flipped private→public heuristic: created long ago but pushed recently,
      // low fork/star count, low watchers (suggests it was private then flipped)
      if (days(r.created_at) > 180 && days(r.pushed_at) < 14 && r.stargazers_count < 5 && r.watchers_count < 5 && !r.fork) {
        recentFlippedPublic++;
      }
    }
  }

  // Compose 0-10 score
  let score = 0;
  score += Math.min(4, Math.floor(activity30 / 5));          // 5 events = 1 pt, up to 4
  score += Math.min(2, Math.floor(orgCount / 2));             // 2 orgs = 1 pt, up to 2
  score += Math.min(3, recentReposCreated);                   // 1 recent repo = 1 pt, up to 3
  if (recentFlippedPublic > 0) score += 1;                    // Leading indicator bonus
  if (activity30 === 0 && recentReposCreated === 0) score = 0;

  return {
    activity_score: Math.min(10, score),
    data: {
      login,
      events_30d: activity30,
      commits_30d: commits,
      prs_30d: prs,
      orgs: orgCount,
      repos_created_60d: recentReposCreated,
      flipped_public: recentFlippedPublic,
      last_event_days: events.data[0] ? Math.floor(days(events.data[0].created_at)) : null,
    },
  };
}

// ══════════════════════════════════════════════════════════════════════════
// FOUNDER SLOPE — the derivative, not the level.
//
// Danny: "At pre-seed we really care about founder slope." And the red team's
// sharpest point: the alpha isn't high activity (visible to everyone) — it's the
// INFLECTION, the moment output/audience just started bending upward, before it's
// obvious. A repo with 20k stars is on every scout's radar; a repo that went 0→300
// in four months, that credible engineers just started depending on, is not yet.
//
// This computes slope from the SAME two API calls computeGithubActivity already
// makes (events + repos) — no extra cost — and reads three things off them:
//   · ACCELERATION — events in the last 30d vs the 30d before. Is output speeding up?
//   · STAR VELOCITY — the top repo's stars ÷ its age in months. NOT total stars
//     (which are botted and lag); the RATE an audience is forming. Hard to fake.
//   · INFLECTION — a non-fork repo created in the last year that has already crossed
//     a real star threshold. This is "just shipped something taking off" — the
//     highest-alpha, earliest signal.
//
// Returns a 0-10 slope score + evidence, or null if no usable GitHub. Deliberately
// favors the recent and the accelerating over the accumulated — an early builder
// with a fast-rising repo outscores a veteran with an old famous one.
// ══════════════════════════════════════════════════════════════════════════
// Content, not a product — excluded from velocity/inflection (VC red team).
const CONTENT_REPO = /\b(awesome|awesome-|list|lists|dotfiles|tutorial|guide|guides|notes|book|books|roadmap|interview|cheat-?sheet|skills|prompts?|resources?|handbook|curriculum|course|courses|learn|learning|101|examples?|demos?|blog|portfolio|readme|papers?|wiki|docs|documentation|boilerplate|template|starter|config|configs)\b/i;

// Returns { slope_score, data, evidence } | null (no usable GitHub) | { failed:true }
// (a fetch error — NOT the same as "scored 0"; the caller must not persist a failure).
async function computeGithubSlope(ghUrl, token) {
  const login = ghLoginFromUrl(ghUrl);
  if (!login) return null;
  const now = Date.now();
  const days = (ms) => (now - new Date(ms).getTime()) / (1000 * 60 * 60 * 24);
  const months = (ms) => Math.max(1, days(ms) / 30.4);

  const events = await ghGet(`/users/${login}/events/public?per_page=100`, token);
  // A non-200 here is a FETCH FAILURE, not "no activity". Signal it so the caller
  // retries rather than permanently recording slope 0 (engineering red team F6).
  if (events.status !== 200) return { failed: true };
  if (!Array.isArray(events.data)) return { failed: true };

  // ACCELERATION — recent 30d vs the 30d before. But the events feed is one page
  // (~90d max, far less for hyperactive users). If it doesn't demonstrably reach back
  // 60 days, we CAN'T compute a derivative — treat as unknown (1), never a bonus,
  // else the busiest builders get a fake "accelerating" from truncation (F9).
  const isBuild = (e) => e.type === 'PushEvent' || e.type === 'PullRequestEvent' || e.type === 'CreateEvent';
  const oldestEventDays = events.data.length ? days(events.data[events.data.length - 1].created_at) : 0;
  const windowCovers60 = oldestEventDays >= 58;
  const last30 = events.data.filter((e) => isBuild(e) && days(e.created_at) <= 30).length;
  const prev30 = events.data.filter((e) => isBuild(e) && days(e.created_at) > 30 && days(e.created_at) <= 60).length;
  const accel = !windowCovers60 ? 1 : (prev30 === 0 ? (last30 > 0 ? 2 : 0) : last30 / prev30);

  const repos = await ghGet(`/users/${login}/repos?sort=pushed&direction=desc&per_page=100`, token);
  if (repos.status !== 200) return { failed: true };
  let topRepo = null, starVelocity = 0, inflection = null, totalStars = 0, freshestPushDays = Infinity;
  if (Array.isArray(repos.data)) {
    for (const r of repos.data) {
      if (r.fork) continue;
      // CONTENT is not a PRODUCT (Jim Liu's "baoyu-skills, 23,982★" is a list).
      if (CONTENT_REPO.test(`${r.name} ${r.description || ''}`)) continue;
      totalStars += r.stargazers_count || 0;
      freshestPushDays = Math.min(freshestPushDays, days(r.pushed_at));
      if (!topRepo || (r.stargazers_count || 0) > (topRepo.stargazers_count || 0)) topRepo = r;
      // STAR VELOCITY — only for RECENT repos (≤18mo). Dividing lifetime stars by a
      // repo's whole age is a diluted historical average, not the current rate; an old
      // 500★ repo shows ~8★/mo forever (F8). Velocity should mean "rising NOW".
      if (days(r.created_at) <= 550) {
        const vel = (r.stargazers_count || 0) / months(r.created_at);
        if (vel > starVelocity) starVelocity = vel;
      }
      // INFLECTION — a repo created in the last year already past a REAL bar. Raised
      // from 20 to 75: 20 stars is one tweet, and it was auto-promoting to must-meet
      // (F7). 75+ on a young product repo is a genuine "taking off".
      if (days(r.created_at) <= 365 && (r.stargazers_count || 0) >= 75) {
        if (!inflection || (r.stargazers_count || 0) > (inflection.stargazers_count || 0)) inflection = r;
      }
    }
  }

  // DORMANT GUARD — slope is about building NOW. An account whose last push was
  // months ago and had no events in 30d has no slope, however famous an old repo is
  // (this is what over-scored octocat: a 14k-star tutorial fork from years back).
  const dormant = last30 === 0 && freshestPushDays > 120;

  // Compose 0-10. Star velocity is the spine; inflection and acceleration are bonuses.
  let score = 0;
  if (!dormant) {
    if (starVelocity >= 50) score += 5;
    else if (starVelocity >= 15) score += 4;
    else if (starVelocity >= 5) score += 3;
    else if (starVelocity >= 1) score += 2;
    if (inflection) score += 3;                    // the earliest, highest-alpha signal
    if (accel >= 1.5 && last30 >= 3) score += 2;   // output genuinely speeding up
    else if (accel >= 1 && last30 >= 3) score += 1;
    if (totalStars >= 500 && score < 2) score = 2; // a real audience floors the score
  }
  score = Math.min(10, score);

  const ev = [];
  if (inflection) ev.push(`${inflection.name}: ${inflection.stargazers_count}★ in ${Math.round(days(inflection.created_at) / 30.4)}mo`);
  else if (topRepo && topRepo.stargazers_count >= 10) ev.push(`${topRepo.name}: ${topRepo.stargazers_count}★ (${(topRepo.stargazers_count / months(topRepo.created_at)).toFixed(0)}★/mo)`);
  if (accel >= 1.5 && last30 >= 3) ev.push('commits accelerating');

  return {
    slope_score: score,
    data: {
      login, star_velocity: Math.round(starVelocity * 10) / 10, total_stars: totalStars,
      accel: Math.round(accel * 100) / 100, last30, prev30, dormant,
      top_repo: topRepo ? { name: topRepo.name, stars: topRepo.stargazers_count } : null,
      inflection: inflection ? { name: inflection.name, stars: inflection.stargazers_count, age_days: Math.round(days(inflection.created_at)) } : null,
    },
    evidence: ev.join(' · ') || null,
  };
}

async function scoreGithubActivity({ userId, githubToken, limit = 10 }) {
  const rows = db.prepare(`
    SELECT id, github_url, linkedin_url, confidence_score
    FROM sourced_founders
    WHERE user_id = ? AND status IN ('pending', 'starred')
      AND github_url IS NOT NULL AND github_url != ''
      AND github_activity_score IS NULL
      AND confidence_score >= 6
    ORDER BY confidence_score DESC
    LIMIT ?
  `).all(userId, limit);

  if (rows.length === 0) return { scored: 0 };

  const updateStmt = db.prepare(`
    UPDATE sourced_founders
    SET github_activity_score = ?,
        github_activity_data = ?,
        confidence_score = MIN(10, confidence_score + CASE WHEN ? >= 6 THEN 1 ELSE 0 END)
    WHERE id = ? AND user_id = ?
  `);

  let scored = 0;
  for (const row of rows) {
    const result = await computeGithubActivity(row.github_url, githubToken);
    if (!result) continue;
    updateStmt.run(result.activity_score, JSON.stringify(result.data), result.activity_score, row.id, userId);
    scored++;
    // Rate limit: GitHub allows 5000/hr authed, be polite
    await new Promise(r => setTimeout(r, 400));
  }
  console.log(`[GH-Activity] Scored ${scored} candidates`);
  return { scored };
}

// Batch: compute slope for pool founders with a GitHub whose score is missing OR
// STALE (older than a week). Slope is time-varying — scoring once and freezing it
// would make "building fast" a permanent label and starve the movers view of deltas.
async function scoreGithubSlope({ userId, githubToken, limit = 40, staleDays = 7 } = {}) {
  const rows = db.prepare(`
    SELECT id, github_url FROM sourced_founders
    WHERE user_id = ? AND status IN ('pending','starred')
      AND github_url IS NOT NULL AND github_url != ''
      AND (github_slope_score IS NULL
           OR github_slope_scored_at IS NULL
           OR github_slope_scored_at < datetime('now', ?))
    ORDER BY (github_slope_scored_at IS NULL) DESC, github_slope_scored_at ASC
    LIMIT ?
  `).all(userId, `-${staleDays} days`, limit);
  if (!rows.length) return { scored: 0, remaining: 0 };

  const upd = db.prepare("UPDATE sourced_founders SET github_slope_score = ?, github_slope_data = ?, github_slope_scored_at = CURRENT_TIMESTAMP WHERE id = ? AND user_id = ?");
  let scored = 0, failed = 0;
  for (const row of rows) {
    const r = await computeGithubSlope(row.github_url, githubToken);
    // A FETCH FAILURE ({failed:true}) must NOT be written — persisting it as slope 0
    // would leave github_slope_score non-null, so the row is never retried, and a
    // transient 403 permanently zeroes a real builder (engineering red team F6).
    // A genuine null (no usable account) stores 0 so a dead handle isn't re-fetched.
    if (r && r.failed) { failed++; await new Promise((res) => setTimeout(res, 350)); continue; }
    upd.run(r ? r.slope_score : 0, r ? JSON.stringify({ ...r.data, evidence: r.evidence }) : null, row.id, userId);
    scored++;
    await new Promise((res) => setTimeout(res, 350)); // polite to GitHub's rate limit
  }
  // Remaining = still missing OR stale, matching the select — so the drain loop in the
  // radar terminates when nothing needs (re)scoring this run. `failed` rows stay
  // NULL and count as remaining (correct: they need a retry).
  const remaining = db.prepare(`
    SELECT COUNT(*) n FROM sourced_founders WHERE user_id = ? AND status IN ('pending','starred')
      AND github_url IS NOT NULL AND github_url != ''
      AND (github_slope_score IS NULL OR github_slope_scored_at IS NULL OR github_slope_scored_at < datetime('now', ?))
  `).get(userId, `-${staleDays} days`).n;
  return { scored, failed, remaining };
}

module.exports = { scoreGithubActivity, scoreGithubSlope, computeGithubActivity, computeGithubSlope, ghLoginFromUrl, CONTENT_REPO };
