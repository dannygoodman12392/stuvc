'use strict';
// The builder-radar pipeline — the whole weekly slope loop in one place, so the cron
// and a manual "run now" trigger share the exact same code. Order matters:
//   backfill (free GitHub links from the scrape)
//   → resolve (corroborated LinkedIn→GitHub, bounded)
//   → score   (compute slope for everyone who now has a github_url)
//   → discover (source new IL builders natively from GitHub)
//   → snapshot (capture state so slope becomes a week-over-week delta)
// Every step is wrapped so one failing connector can't sink the run.

const { recordJobRun } = require('./health');

async function runBuilderRadar({ userId = 1, token = process.env.GITHUB_TOKEN } = {}) {
  const out = { backfilled: 0, resolved: 0, scored: 0, discovered: 0, snapshotted: 0, errors: [] };

  try {
    const { backfillGithubFromScrape } = require('../pipeline/github-source');
    out.backfilled = backfillGithubFromScrape({ userId }).github_url_set;
  } catch (e) { out.errors.push(`backfill: ${e.message}`); }

  try {
    const { resolveGithubHandles } = require('../pipeline/github-resolve');
    out.resolved = (await resolveGithubHandles({ userId, token, limit: 60 })).resolved;
  } catch (e) { out.errors.push(`resolve: ${e.message}`); }

  try {
    const { scoreGithubSlope } = require('../pipeline/github-activity');
    let guard = 0;
    for (;;) {
      const r = await scoreGithubSlope({ userId, githubToken: token, limit: 40 });
      out.scored += r.scored;
      if (r.remaining === 0 || r.scored === 0 || ++guard >= 15) break;
    }
  } catch (e) { out.errors.push(`score: ${e.message}`); }

  try {
    const { discoverGithubBuilders } = require('../pipeline/github-source');
    out.discovered = (await discoverGithubBuilders({ userId, token, candidatesPerQuery: 20, pages: 1 })).added;
  } catch (e) { out.errors.push(`discover: ${e.message}`); }

  try {
    const { captureSnapshots } = require('./slope-snapshots');
    out.snapshotted = captureSnapshots({ userId }).captured;
  } catch (e) { out.errors.push(`snapshot: ${e.message}`); }

  const summary = `${out.backfilled} backfilled, ${out.resolved} resolved, ${out.scored} scored, ${out.discovered} new builders, ${out.snapshotted} snapshotted`;
  recordJobRun('slope_refresh', out.errors.length ? 'error' : 'ok', out.errors.length ? `${summary}; errors: ${out.errors.join('; ')}` : summary, userId);
  return { ...out, summary };
}

module.exports = { runBuilderRadar };
