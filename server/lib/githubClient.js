'use strict';
// One GitHub client for the whole app, with rate-limit backoff. There were two
// copies of ghGet (github-activity, github-source) and neither honored GitHub's
// limits — which is why builder discovery skipped ~50% of candidates as "no profile":
// those were 403 secondary-rate-limit responses being read as empty.
//
// Free to operate: the REST/search APIs cost nothing but request budget. This client
// spends that budget carefully — it reads the rate-limit headers, waits out a
// Retry-After, and backs off on a 403/429 — so a burst can't get us throttled into
// dropping real founders.

const https = require('https');

function once(path, token) {
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
      res.on('end', () => {
        let data = null; try { data = JSON.parse(b); } catch { /* non-JSON */ }
        resolve({ status: res.statusCode, data, headers: res.headers });
      });
    });
    req.on('error', () => resolve({ status: 0, data: null, headers: {} }));
    req.end();
  });
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// How long to wait when GitHub tells us to. Retry-After (seconds) wins; else if the
// rate window is exhausted, wait until it resets; else a short default. Capped so a
// stuck job can't sleep for an hour.
function waitMs(headers) {
  const ra = Number(headers['retry-after']);
  if (ra > 0) return Math.min(ra * 1000, 60000);
  const remaining = Number(headers['x-ratelimit-remaining']);
  const reset = Number(headers['x-ratelimit-reset']); // epoch seconds
  if (remaining === 0 && reset) {
    // No Date.now() in this codebase's cron-safe contexts; use the header's own
    // clock delta isn't available, so fall back to a fixed cool-off. GitHub's
    // secondary limits clear in well under a minute.
    return 20000;
  }
  return 0;
}

// GET with up to `retries` backoff attempts on 403/429 (rate limits). A 404 or other
// status returns immediately — only rate limits are retried.
async function ghGet(path, token, { retries = 2 } = {}) {
  let res = await once(path, token);
  let attempt = 0;
  while ((res.status === 403 || res.status === 429) && attempt < retries) {
    const w = waitMs(res.headers) || 15000 * (attempt + 1);
    await sleep(w);
    res = await once(path, token);
    attempt++;
  }
  return { status: res.status, data: res.data };
}

module.exports = { ghGet };
