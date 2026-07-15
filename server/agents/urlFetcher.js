/**
 * Site crawler — turns a company URL into something worth reading.
 * ================================================================
 *
 * The previous version was 60 lines: one `https.get`, a regex tag-strip, 50K cap. It had
 * three problems that made every URL-driven feature in Stu hollow:
 *
 *   1. ONE PAGE. A homepage is a slogan. Everything that actually tells you about a
 *      company — what it costs, who buys it, who they're hiring, which logos are real —
 *      lives on the subpages.
 *   2. NO JS RENDERING, and it reported an empty read as SUCCESS. Most modern startup
 *      sites are React/Next; the fetch returns a shell, the regex strips it to nothing,
 *      and the agents scored the nothing.
 *   3. REGEX PARSING. `cheerio` has been a dependency this whole time, unused.
 *
 * For JS-rendered sites we detect the empty read and fall back to Exa's renderer (see
 * renderViaExa). If that isn't available or finds nothing either, the result is an
 * honest gap rather than a confident nothing — which is what the old fetcher returned.
 *
 * The page priority list is not arbitrary. These are the pages where a marketing site
 * accidentally tells the truth:
 *   /pricing   — the single most information-dense page a company has. Self-serve vs.
 *                "contact sales" settles the GTM question on its own.
 *   /careers   — what they're hiring reveals the real roadmap and the real burn. Ten AEs
 *                and no engineers is a different company than the homepage claims.
 *   /customers — named logos are evidence. "Trusted by teams at" with no names is not.
 *   /about     — the founding story, which is the closest a website gets to earned insight.
 */
const https = require('https');
const http = require('http');
const cheerio = require('cheerio');

const UA = 'SuperiorOS/1.0 (+https://stu.vc)';
const PAGE_TIMEOUT = 12000;
const MAX_PAGES = 10;
const PER_PAGE_CHARS = 20000;
const TOTAL_CHARS = 60000;

// Fetched pages, keyed by URL. Process-lifetime, so a re-run inside a session doesn't
// re-hammer someone's site. There was no cache anywhere in Stu before this.
const CACHE = new Map();
const CACHE_TTL_MS = 15 * 60 * 1000;

function rawFetch(url, timeout = PAGE_TIMEOUT, depth = 0) {
  return new Promise((resolve, reject) => {
    if (depth > 4) return reject(new Error('too many redirects'));
    let lib;
    try {
      lib = new URL(url).protocol === 'http:' ? http : https;
    } catch {
      return reject(new Error('invalid URL'));
    }
    const req = lib.get(url, { headers: { 'User-Agent': UA, Accept: 'text/html,application/xhtml+xml' } }, (res) => {
      if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
        res.resume();
        const next = new URL(res.headers.location, url).href;
        return rawFetch(next, timeout, depth + 1).then(resolve).catch(reject);
      }
      if (res.statusCode !== 200) {
        res.resume();
        return reject(new Error(`HTTP ${res.statusCode}`));
      }
      const ctype = String(res.headers['content-type'] || '');
      if (ctype && !/text\/html|text\/plain|application\/xhtml/i.test(ctype)) {
        res.resume();
        return reject(new Error(`not HTML (${ctype.split(';')[0]})`));
      }
      let data = '';
      let bytes = 0;
      res.setEncoding('utf8');
      res.on('data', (chunk) => {
        bytes += chunk.length;
        if (bytes > 3_000_000) { req.destroy(); return; } // don't swallow a huge asset
        data += chunk;
      });
      res.on('end', () => resolve({ html: data, finalUrl: url }));
    });
    req.on('error', (e) => reject(new Error(e.code || e.message)));
    req.setTimeout(timeout, () => { req.destroy(); reject(new Error('timeout')); });
  });
}

async function fetchCached(url) {
  const hit = CACHE.get(url);
  if (hit && Date.now() - hit.at < CACHE_TTL_MS) return hit.value;
  const value = await rawFetch(url);
  CACHE.set(url, { at: Date.now(), value });
  return value;
}

// Plenty of real company sites serve only ONE of apex / www — the other either has no
// DNS or, more often, a TLS cert that doesn't cover it. Measured: www.cadrian.ai throws
// ERR_TLS_CERT_ALTNAME_INVALID while cadrian.ai is fine. Danny will paste whichever form
// he copied out of an email, and "your URL is wrong" is a stupid reason to fail a
// diligence run, so try the other form before giving up.
async function fetchWithHostFallback(url) {
  try {
    return await fetchCached(url);
  } catch (err) {
    const hostErr = /ERR_TLS_CERT_ALTNAME_INVALID|ENOTFOUND|ERR_TLS|CERT_|EAI_AGAIN/i.test(err.message);
    if (!hostErr) throw err;
    let alt;
    try {
      const u = new URL(url);
      u.hostname = u.hostname.startsWith('www.') ? u.hostname.slice(4) : `www.${u.hostname}`;
      alt = u.href;
    } catch { throw err; }
    try {
      const value = await fetchCached(alt);
      CACHE.set(url, { at: Date.now(), value }); // remember the working form
      return value;
    } catch {
      throw err; // report the original failure, not the fallback's
    }
  }
}

/**
 * JS rendering, via Exa — the fallback for sites we cannot read directly.
 *
 * This is not a nice-to-have. Measured against real targets: cadrian.ai (the company
 * Danny actually ran through Gutcheck) and avanthealth.com are BOTH client-rendered and
 * return ~0 readable chars to a plain fetch. Half the startup sites that matter here are
 * unreadable without rendering, so a URL-in product that can't render is a URL-in
 * product that doesn't work. Gutcheck reads Cadrian; a plain fetch cannot.
 *
 * Exa is used rather than a headless browser because Stu already depends on it and
 * already pays for it — no new dependency, no chromium in the Docker image.
 *
 * NOTE FOR THE READER: this path could NOT be tested locally — there is no EXA_API_KEY
 * in the local .env (production has one; /api/health reports has_exa: true). It is
 * written so its failure mode is exactly the previous behaviour: if the key is missing,
 * or Exa errors, or Exa returns nothing useful, we fall through to the honest
 * "client-rendered, cannot read it" error. The worst case is today's behaviour, which is
 * why it was acceptable to ship unverified. Verify with a real client-rendered URL.
 */
async function renderViaExa(url, exaKey) {
  if (!exaKey) return null;
  try {
    const res = await fetch('https://api.exa.ai/contents', {
      method: 'POST',
      headers: { 'x-api-key': exaKey, 'Content-Type': 'application/json' },
      body: JSON.stringify({ urls: [url], text: true, livecrawl: 'always' }),
      signal: AbortSignal.timeout(45000),
    });
    if (!res.ok) return null;
    const json = await res.json();
    const hit = (json.results || [])[0];
    const text = (hit && hit.text ? String(hit.text) : '').trim();
    if (text.length < 300) return null; // Exa read it too, and there was nothing there
    return { text, title: (hit.title || '').trim() };
  } catch {
    return null;
  }
}

/** Extract readable text with cheerio, dropping chrome that carries no signal. */
function extractText($) {
  $('script, style, noscript, svg, iframe, nav, footer, header, form, [aria-hidden="true"]').remove();
  const text = $('main').text() || $('body').text() || '';
  return text.replace(/[ \t ]+/g, ' ').replace(/\n\s*\n\s*\n+/g, '\n\n').trim();
}

/**
 * Did we actually read a page, or a JS shell?
 * A React/Next site returns a <div id="root"></div> and a script tag. Stripped, that is
 * a few dozen characters — and the old fetcher returned it with error: null.
 */
function looksClientRendered(text, html) {
  if (text.length >= 500) return false;
  return /__NEXT_DATA__|id="root"|id="__next"|data-reactroot|ng-version|<div id="app">/i.test(html) || text.length < 200;
}

// Paths worth spending a fetch on, best first.
const PRIORITY = [
  { re: /^\/pricing|^\/plans|^\/price/i, kind: 'pricing', score: 100 },
  { re: /^\/about|^\/company|^\/team|^\/story|^\/mission/i, kind: 'about', score: 90 },
  { re: /^\/customers|^\/case-stud|^\/testimonial|^\/who-we-serve/i, kind: 'customers', score: 85 },
  { re: /^\/product|^\/platform|^\/features|^\/how-it-works|^\/solutions/i, kind: 'product', score: 80 },
  { re: /^\/careers|^\/jobs|^\/join|^\/hiring/i, kind: 'careers', score: 70 },
  { re: /^\/docs|^\/documentation|^\/developers|^\/api/i, kind: 'docs', score: 60 },
  { re: /^\/security|^\/compliance|^\/trust|^\/privacy/i, kind: 'compliance', score: 50 },
  { re: /^\/blog|^\/news|^\/insights|^\/resources/i, kind: 'blog', score: 30 },
];

function classify(pathname) {
  for (const p of PRIORITY) if (p.re.test(pathname)) return p;
  return null;
}

/** Same-origin internal links, ranked by how much signal the path promises. */
function discoverLinks($, rootUrl) {
  const root = new URL(rootUrl);
  const seen = new Map();
  $('a[href]').each((_, el) => {
    const href = $(el).attr('href');
    if (!href || /^(mailto:|tel:|javascript:|#)/i.test(href)) return;
    let u;
    try { u = new URL(href, rootUrl); } catch { return; }
    if (u.hostname !== root.hostname) return;
    if (/\.(pdf|png|jpe?g|gif|svg|zip|mp4|webp|ico|css|js)$/i.test(u.pathname)) return;
    u.hash = '';
    const key = u.href.replace(/\/$/, '');
    if (key === rootUrl.replace(/\/$/, '')) return;
    const hit = classify(u.pathname);
    if (!hit) return;
    if (!seen.has(hit.kind) || seen.get(hit.kind).score < hit.score) {
      seen.set(hit.kind, { url: u.href, kind: hit.kind, score: hit.score });
    }
  });
  return [...seen.values()].sort((a, b) => b.score - a.score);
}

/** Respect robots.txt. We are crawling companies we may want to invest in. */
async function disallowedPaths(rootUrl) {
  try {
    const { html } = await fetchWithHostFallback(new URL("/robots.txt", rootUrl).href);
    const lines = String(html).split('\n').map((l) => l.trim());
    const out = [];
    let applies = false;
    for (const line of lines) {
      const [rawKey, ...rest] = line.split(':');
      const key = (rawKey || '').trim().toLowerCase();
      const val = rest.join(':').trim();
      if (key === 'user-agent') applies = val === '*' || /superioros/i.test(val);
      else if (key === 'disallow' && applies && val) out.push(val);
    }
    return out;
  } catch {
    return []; // no robots.txt is permission
  }
}

function isBlocked(url, disallows) {
  try {
    const p = new URL(url).pathname;
    return disallows.some((d) => d !== '/' && p.startsWith(d));
  } catch {
    return false;
  }
}

/**
 * Crawl a company site. Returns combined readable text plus a per-page manifest, so the
 * reader can see exactly which pages were read rather than trusting a blob.
 */
async function crawlSite(rootUrl, { maxPages = MAX_PAGES, exaKey = null } = {}) {
  const pages = [];
  const notes = [];
  let title = '';

  let root;
  try {
    root = new URL(/^https?:\/\//i.test(rootUrl) ? rootUrl : `https://${rootUrl}`).href;
  } catch {
    return { url: rootUrl, title: '', text: '', pages: [], notes: [], error: 'invalid URL' };
  }

  let home;
  try {
    home = await fetchWithHostFallback(root);
  } catch (err) {
    return { url: root, title: '', text: '', pages: [], notes: [], error: err.message };
  }

  // Crawl from where we actually LANDED, not where we were pointed. A redirect or the
  // apex/www fallback changes the origin, and discoverLinks filters to same-hostname —
  // so basing it on the requested URL would silently reject every internal link and
  // return a one-page crawl that looks like a site with no subpages.
  if (home.finalUrl) root = home.finalUrl;

  const $home = cheerio.load(home.html);
  title = ($home('title').first().text() || '').replace(/\s+/g, ' ').trim();
  const homeText = extractText($home);

  if (looksClientRendered(homeText, home.html)) {
    // Half the startup sites worth assessing land here. Try to render before giving up.
    const rendered = await renderViaExa(root, exaKey);
    if (!rendered) {
      return {
        url: root, title, text: '', pages: [], notes: [],
        error: exaKey
          ? `the page is client-rendered and we could not render it (returned ${homeText.length} readable chars directly, and the renderer found nothing usable)`
          : `the page is client-rendered and returned only ${homeText.length} readable chars — rendering it needs an Exa key, which is not configured`,
      };
    }
    // Rendered pages are single-page: Exa gives us the page, not the site graph. That's
    // the trade, and it's worth saying so rather than implying we read the whole site.
    notes.push('rendered via Exa (client-rendered site) — homepage only, subpages not crawled');
    return {
      url: root,
      title: title || rendered.title,
      text: `\n\n===== HOME (rendered) — ${root} =====\n${rendered.text.slice(0, TOTAL_CHARS)}`.trim(),
      pages: [{ url: root, kind: 'home', title: title || rendered.title, text: rendered.text.slice(0, PER_PAGE_CHARS), rendered: true }],
      notes,
      error: null,
    };
  }
  pages.push({ url: root, kind: 'home', title, text: homeText.slice(0, PER_PAGE_CHARS) });

  const disallows = await disallowedPaths(root);
  const links = discoverLinks($home, root).filter((l) => {
    if (isBlocked(l.url, disallows)) { notes.push(`skipped ${l.kind} (robots.txt)`); return false; }
    return true;
  });

  for (const link of links.slice(0, maxPages - 1)) {
    try {
      const { html } = await fetchCached(link.url);
      const $ = cheerio.load(html);
      const text = extractText($);
      if (text.length < 150) { notes.push(`${link.kind}: empty or client-rendered`); continue; }
      pages.push({
        url: link.url,
        kind: link.kind,
        title: ($('title').first().text() || '').replace(/\s+/g, ' ').trim(),
        text: text.slice(0, PER_PAGE_CHARS),
      });
    } catch (err) {
      notes.push(`${link.kind}: ${err.message}`);
    }
  }

  // Combine, newest-signal-first, under a total budget.
  let combined = '';
  for (const p of pages) {
    const block = `\n\n===== ${p.kind.toUpperCase()} — ${p.url} =====\n${p.text}`;
    if (combined.length + block.length > TOTAL_CHARS) { notes.push(`truncated at ${pages.indexOf(p)} pages (budget)`); break; }
    combined += block;
  }

  return { url: root, title, text: combined.trim(), pages, notes, error: null };
}

/**
 * Back-compatible single-URL API. Now crawls, so a company URL yields the site rather
 * than the homepage. Callers get `.text` exactly as before.
 */
async function fetchUrlContent(url, { exaKey = null } = {}) {
  const r = await crawlSite(url, { exaKey });
  return {
    url: r.url,
    title: r.title,
    text: r.text,
    pages: r.pages.map((p) => ({ url: p.url, kind: p.kind })),
    notes: r.notes,
    error: r.error,
  };
}

module.exports = { fetchUrlContent, crawlSite, extractText, looksClientRendered, discoverLinks, _cache: CACHE };
