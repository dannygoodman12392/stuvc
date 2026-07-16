'use strict';
// ══════════════════════════════════════════════════════════════════════════
// The failure to protect against is "not hiring" — the one sentence this module
// must never say. Everything else it gets wrong is recoverable; that one puts a
// false fact on a card Danny reads before a partner call.
//
// All fixtures are the shapes the real APIs returned on 2026-07-16, including
// Lever's 200-with-empty-array, which is the whole reason the module is built the
// way it is.
// ══════════════════════════════════════════════════════════════════════════

const test = require('node:test');
const assert = require('node:assert');
const { hiringFor, findAts, domainLabel, originOf, isCompanySite, readTells } = require('../lib/hiring');

const ghJobs = (titles) => JSON.stringify({
  jobs: titles.map((t, i) => ({
    title: t, location: { name: 'Chicago, IL' }, absolute_url: `https://job-boards.greenhouse.io/x/jobs/${i}`,
    first_published: '2026-07-01T10:00:00-04:00', updated_at: '2026-07-10T10:00:00-04:00', company_name: 'X',
  })),
});
const ashbyJobs = (titles) => JSON.stringify({
  apiVersion: '1',
  jobs: titles.map((t, i) => ({
    id: String(i), title: t, department: 'Engineering', location: 'New York, NY (HQ)',
    isRemote: false, isListed: true, publishedAt: '2026-06-20T00:00:00Z',
    jobUrl: `https://jobs.ashbyhq.com/acme/${i}`,
  })),
});
const leverJobs = (titles) => JSON.stringify(titles.map((t, i) => ({
  text: t, categories: { location: 'Romeoville, IL', team: 'Pharmacy', commitment: 'Full-time' },
  createdAt: 1750119882479, hostedUrl: `https://jobs.lever.co/acme/${i}`, workplaceType: 'onsite',
})));

const page = (html) => ({ status: 200, body: html });
const NOT_FOUND = { status: 404, body: '{"status":404,"error":"Job not found"}' };

// ─────────────────────────── plumbing ───────────────────────────

test('domainLabel + originOf take what founders actually paste', () => {
  assert.equal(domainLabel('https://www.ramp.com/careers'), 'ramp');
  assert.equal(domainLabel('linear.app'), 'linear');
  assert.equal(domainLabel('http://foo.co.uk'), 'foo');
  assert.equal(originOf('ramp.com'), 'https://ramp.com', 'a bare domain is the normal paste');
  assert.equal(originOf(''), null);
});

test('findAts pulls every board reference out of real page HTML', () => {
  // The shape ramp.com and linear.app actually serve.
  assert.deepEqual(findAts('<a href="https://jobs.ashbyhq.com/ramp">Careers</a>'), [{ ats: 'ashby', slug: 'ramp' }]);
  assert.deepEqual(findAts('<a href="https://job-boards.greenhouse.io/acme/jobs/123">'), [{ ats: 'greenhouse', slug: 'acme' }]);
  assert.deepEqual(findAts('see https://jobs.lever.co/acme/abc-123'), [{ ats: 'lever', slug: 'acme' }]);
});

test('findAts ignores the ATS’s own utility pages', () => {
  assert.deepEqual(findAts('<script src="https://jobs.ashbyhq.com/embed/foo.js">'), []);
});

test('readTells reads the roadmap out of the titles, and stays quiet otherwise', () => {
  assert.deepEqual(readTells([{ title: 'Founding AE' }]), [{ role: 'Founding AE', means: 'first real go-to-market hire' }]);
  assert.deepEqual(readTells([{ title: 'Senior Backend Engineer' }]), [], 'a list that flags everything flags nothing');
});

test('a profile URL in the website field is refused, not crawled', async () => {
  // Live on the board 2026-07-16: LegalOS's website_url is
  // https://www.linkedin.com/in/matthew-asir — a founder's profile, pasted into the
  // website field. Crawl it and LinkedIn Corp's 20,000-person careers page lands on
  // a 4-person card.
  const calls = [];
  const r = await hiringFor({
    company: 'LegalOS', website: 'https://www.linkedin.com/in/matthew-asir',
    deps: { get: async (u) => { calls.push(u); return page('<html/>'); } },
  });
  assert.equal(r.found, false);
  assert.equal(calls.length, 0, 'never fetch it at all');
  assert.match(r.reason, /profile rather than the company/i);
});

test('isCompanySite knows an aggregator from a company', () => {
  assert.equal(isCompanySite('https://www.linkedin.com/in/x'), false);
  assert.equal(isCompanySite('https://crunchbase.com/organization/x'), false);
  assert.equal(isCompanySite('https://github.com/x'), false);
  assert.equal(isCompanySite('https://ramp.com'), true);
  assert.equal(isCompanySite('https://openmatter.network'), true);
});

test('two URLs pasted into one field: take the first', () => {
  // Live on the board: "https://openmatter.network https://zkfirewall.openmatter.network"
  assert.equal(originOf('https://openmatter.network https://zkfirewall.openmatter.network '), 'https://openmatter.network');
});

test('garbage in the website field is not a hostname', () => {
  assert.equal(originOf('tbd'), null);
  assert.equal(originOf('n/a'), null);
});

// ─────────────────────────── the one rule ───────────────────────────

test('THE RULE: no board found is never reported as "not hiring"', async () => {
  const r = await hiringFor({
    company: 'Cadrian', website: 'cadrian.com',
    deps: {
      get: async (url) => {
        if (url.includes('greenhouse')) return NOT_FOUND;
        if (url === 'https://cadrian.com') return page('<html><body>A landing page with no careers link</body></html>');
        return NOT_FOUND;
      },
    },
  });
  assert.equal(r.found, false);
  assert.ok(!/not hiring/i.test(r.reason), 'THE line this module must never say');
  assert.match(r.reason, /says nothing about whether/i);
});

test('an SPA that answers 200 for every path does not get a careers page invented for it', async () => {
  // Found by my own fixture, which returned 200 for everything — and that is not a
  // contrived case, it is what Framer/Webflow/Next sites really do. The first cut
  // set careers_url on any path that 200'd, so every soft-404 site would have been
  // reported as "they have a careers page but no job board", which is a claim about
  // a page that doesn't exist.
  const spa = '<html><body>Cadrian — the landing page, served for literally any path</body></html>';
  const r = await hiringFor({
    company: 'Cadrian', website: 'cadrian.com',
    deps: { get: async (url) => (url.includes('greenhouse') ? NOT_FOUND : page(spa)) },
  });
  assert.equal(r.found, false);
  assert.ok(!r.careers_url, 'a 200 from an SPA catch-all is not a careers page');
  assert.match(r.reason, /says nothing about whether/i);
});

test('a real careers page is believed — it looks like one', async () => {
  const r = await hiringFor({
    company: 'Tahini', website: 'tahini.com',
    deps: {
      get: async (url) => {
        if (url === 'https://tahini.com') return page('<html>home, no links</html>');
        if (url === 'https://tahini.com/careers') return page('<html><h1>Open Roles</h1> Email jobs@tahini.com</html>');
        return NOT_FOUND;
      },
    },
  });
  assert.equal(r.careers_url, 'https://tahini.com/careers');
  assert.match(r.reason, /careers page but no job board/i);
});

test('a careers link the site actually publishes is followed', async () => {
  const r = await hiringFor({
    company: 'Acme', website: 'acme.com',
    deps: {
      get: async (url) => {
        if (url === 'https://acme.com') return page('<a href="/company/join-us">Join us</a>');
        if (url === 'https://acme.com/company/join-us') return page('<a href="https://jobs.ashbyhq.com/acme">See roles</a>');
        if (url.includes('job-board/acme')) return page(ashbyJobs(['Founding Engineer']));
        return NOT_FOUND;
      },
    },
  });
  assert.equal(r.found, true);
  assert.equal(r.ats, 'ashby');
  assert.equal(r.careers_url, 'https://acme.com/company/join-us');
});

test('a footer link to somebody else’s job site is not their careers page', async () => {
  const r = await hiringFor({
    company: 'Acme', website: 'acme.com',
    deps: {
      get: async (url) => {
        if (url === 'https://acme.com') return page('<a href="https://www.linkedin.com/jobs/acme">Jobs</a>');
        if (url.includes('greenhouse')) return NOT_FOUND;
        return NOT_FOUND;
      },
    },
  });
  assert.equal(r.found, false);
  assert.ok(!r.careers_url, 'following it would read a board that isn’t theirs');
});

test('Lever’s 200-with-empty-array cannot be reached by guessing', async () => {
  // Live 2026-07-16: api.lever.co/v0/postings/plaid -> 200 []. Plaid runs 100+ roles
  // on Ashby. A dormant Lever account returns a PLAUSIBLE empty list, and nothing in
  // the response distinguishes it from "no open roles". So the only guessing this
  // module does is Greenhouse, which confirms the name back.
  const calls = [];
  const r = await hiringFor({
    company: 'Plaid', website: 'plaid.com',
    deps: {
      get: async (url) => {
        calls.push(url);
        if (url.includes('boards-api.greenhouse.io')) return NOT_FOUND;
        return page('<html>no careers link here</html>');
      },
    },
  });
  assert.equal(r.found, false);
  assert.ok(!calls.some((u) => u.includes('api.lever.co')), 'never probe Lever on a guessed slug');
  assert.ok(!calls.some((u) => u.includes('ashbyhq')), 'never probe Ashby on a guessed slug — it cannot confirm whose board it is');
});

// ─────────────────────────── the happy paths ───────────────────────────

test('a board linked from the company’s own site is trusted', async () => {
  const r = await hiringFor({
    company: 'Ramp', website: 'ramp.com',
    deps: {
      get: async (url) => {
        if (url === 'https://ramp.com') return page('<a href="https://jobs.ashbyhq.com/ramp">Careers</a>');
        if (url.includes('posting-api/job-board/ramp')) return page(ashbyJobs(['Founding Engineer', 'Security Engineer, Cloud']));
        return NOT_FOUND;
      },
    },
  });
  assert.equal(r.found, true);
  assert.equal(r.confidence, 'linked');
  assert.equal(r.ats, 'ashby');
  assert.equal(r.role_count, 2);
  assert.equal(r.board_url, 'https://jobs.ashbyhq.com/ramp');
  assert.deepEqual(r.tells, [{ role: 'Founding Engineer', means: 'still building the thing' }]);
});

test('Greenhouse may be guessed, but only when it confirms the name', async () => {
  const r = await hiringFor({
    company: 'Anthropic', website: 'anthropic.com',
    deps: {
      get: async (url) => {
        if (/boards-api\.greenhouse\.io\/v1\/boards\/anthropic$/.test(url)) return page('{"name":"Anthropic","content":""}');
        if (url.includes('/boards/anthropic/jobs')) return page(ghJobs(['Founding AE', 'Research Engineer']));
        return page('<html>nothing</html>');
      },
    },
  });
  assert.equal(r.found, true);
  assert.equal(r.confidence, 'name-verified');
  assert.match(r.reason, /matches the company name/);
});

test('a Greenhouse board whose name is a DIFFERENT company is refused', async () => {
  // The whole point of the name check. peak.com's Greenhouse slug could belong to
  // Peak Design, and their 40 roles would land on a 4-person card.
  const r = await hiringFor({
    company: 'Peak', website: 'peak.com',
    deps: {
      get: async (url) => {
        if (/\/v1\/boards\/peak$/.test(url)) return page('{"name":"Peak Design","content":""}');
        if (url.includes('/boards/peak/jobs')) return page(ghJobs(['Warehouse Associate']));
        return page('<html>nothing</html>');
      },
    },
  });
  assert.equal(r.found, false, 'Peak Design is not Peak');
});

test('Lever’s epoch-millis timestamps are normalised like everyone else’s', async () => {
  const r = await hiringFor({
    company: 'Ro', website: 'ro.co',
    deps: {
      get: async (url) => {
        if (url === 'https://ro.co') return page('<a href="https://jobs.lever.co/ro">Jobs</a>');
        if (url.includes('api.lever.co/v0/postings/ro')) return page(leverJobs(['Compounding Pharmacy Technician']));
        return NOT_FOUND;
      },
    },
  });
  assert.equal(r.found, true);
  assert.equal(r.roles[0].posted, '2025-06-17T00:24:42.479Z', 'ISO on the card, whichever board it came from');
  assert.equal(r.roles[0].team, 'Pharmacy');
});

test('roles come back newest first — the live question is what they just opened', async () => {
  const r = await hiringFor({
    company: 'Acme', website: 'acme.com',
    deps: {
      get: async (url) => {
        if (url === 'https://acme.com') return page('<a href="https://jobs.ashbyhq.com/acme">Careers</a>');
        if (url.includes('job-board/acme')) {
          return page(JSON.stringify({
            jobs: [
              { id: '1', title: 'Old Role', isListed: true, publishedAt: '2025-01-01T00:00:00Z' },
              { id: '2', title: 'Founding AE', isListed: true, publishedAt: '2026-07-05T00:00:00Z' },
            ],
          }));
        }
        return NOT_FOUND;
      },
    },
  });
  assert.equal(r.roles[0].title, 'Founding AE');
  assert.equal(r.newest_post, '2026-07-05T00:00:00Z');
});

test('unlisted Ashby roles are not open roles', async () => {
  const r = await hiringFor({
    company: 'Acme', website: 'acme.com',
    deps: {
      get: async (url) => {
        if (url === 'https://acme.com') return page('<a href="https://jobs.ashbyhq.com/acme">Careers</a>');
        if (url.includes('job-board/acme')) {
          return page(JSON.stringify({ jobs: [
            { id: '1', title: 'Draft Role', isListed: false, publishedAt: '2026-01-01T00:00:00Z' },
            { id: '2', title: 'Real Role', isListed: true, publishedAt: '2026-01-01T00:00:00Z' },
          ] }));
        }
        return NOT_FOUND;
      },
    },
  });
  assert.equal(r.role_count, 1);
  assert.equal(r.roles[0].title, 'Real Role');
});

test('a card with no website is a missing input, not a finding', async () => {
  const r = await hiringFor({ company: 'Stealth Co', website: '', deps: { get: async () => NOT_FOUND } });
  assert.equal(r.found, false);
  assert.match(r.reason, /no website/i);
});

test('the site being down is not evidence about hiring', async () => {
  const r = await hiringFor({
    company: 'Acme', website: 'acme.com',
    deps: { get: async () => ({ status: 0, body: '' }) },
  });
  assert.equal(r.found, false);
  assert.ok(!/not hiring/i.test(r.reason));
});
