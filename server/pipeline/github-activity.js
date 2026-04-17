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

const https = require('https');
const db = require('../db');

function ghGet(path, token) {
  return new Promise((resolve) => {
    const req = https.request({
      hostname: 'api.github.com',
      path,
      method: 'GET',
      headers: {
        'User-Agent': 'stu-sourcing',
        'Accept': 'application/vnd.github+json',
        ...(token ? { 'Authorization': `Bearer ${token}` } : {}),
      },
    }, (res) => {
      let body = '';
      res.on('data', d => body += d);
      res.on('end', () => {
        try { resolve({ status: res.statusCode, data: JSON.parse(body) }); }
        catch { resolve({ status: res.statusCode, data: null }); }
      });
    });
    req.on('error', () => resolve({ status: 0, data: null }));
    req.end();
  });
}

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

module.exports = { scoreGithubActivity, computeGithubActivity, ghLoginFromUrl };
