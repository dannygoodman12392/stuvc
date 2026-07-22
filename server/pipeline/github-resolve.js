'use strict';
// ══════════════════════════════════════════════════════════════════════════
// LinkedIn → GitHub resolver, verification-gated. Free (GitHub search API, no LLM).
//
// This is the piece that gives the ~1,900 LinkedIn-sourced founders a shot at slope.
// It is also the one Danny most distrusts, correctly: a wrong match hands one
// person's trajectory to another — a hallucination wearing a green checkmark. So the
// bar is deliberately high: a match is accepted ONLY when the name matches AND a
// second, independent fact corroborates (their company, an Illinois location, or a
// cross-link back to their name/site). No corroboration → no match, and the founder
// simply keeps ranking on their other signals. False negatives are cheap here; false
// positives poison the one signal that matters.
//
// Never overwrites an existing github_url, and records HOW it matched so any bad call
// is auditable and reversible.
// ══════════════════════════════════════════════════════════════════════════

const db = require('../db');
const { ghGet } = require('../lib/githubClient');

const norm = (s) => String(s || '').toLowerCase().replace(/[^a-z0-9 ]+/g, ' ').replace(/\s+/g, ' ').trim();
const tokens = (s) => norm(s).split(' ').filter((t) => t.length >= 2);

// Full name match: every token of the founder's name present in the candidate's
// GitHub name, same order-insensitive set. "Chris" vs "Christopher" is allowed via
// prefix, but a bare first-name-only match is NOT enough (too many collisions).
function nameMatches(founderName, ghName) {
  const a = tokens(founderName), b = new Set(tokens(ghName));
  if (a.length < 2) return false; // need at least first + last to disambiguate
  return a.every((t) => b.has(t) || [...b].some((x) => x.startsWith(t) || t.startsWith(x)));
}

// Pull the founder's corroborating facts from whatever we already scraped.
function founderFacts(row) {
  const parts = [];
  for (const blob of [row.linkedin_data, row.enriched_data, row.raw_data]) {
    if (typeof blob === 'string' && blob) {
      try {
        const o = JSON.parse(blob);
        for (const e of o.experiences || []) if (e && e.company) parts.push(e.company);
        for (const e of o.education || []) { const s = e && (e.school || e.school_name); if (s) parts.push(s); }
        if (o.summary) parts.push(o.summary);
      } catch { /* free text */ }
    }
  }
  const companies = [row.company, row.previous_company_norm, ...parts].filter(Boolean).map(norm);
  return {
    companies: [...new Set(companies)].filter((c) => c.length >= 3),
    ilTie: /\b(chicago|illinois|evanston|champaign|urbana|naperville|uiuc|northwestern|uchicago)\b/i.test(
      [row.chicago_connection, row.location_city, ...parts].filter(Boolean).join(' ')
    ),
    nameNorm: norm(row.name),
  };
}

// Score one GitHub candidate against the founder. Returns { ok, reason } — ok only on
// name + at least one independent corroborator.
function corroborate(founder, gh) {
  if (!nameMatches(founder.name, gh.name || gh.login)) return { ok: false };
  const facts = founderFacts(founder);
  const ghBlob = norm([gh.company, gh.bio, gh.location, gh.blog].filter(Boolean).join(' '));

  // Corroborator 1 — a shared company name.
  const co = facts.companies.find((c) => c.length >= 4 && ghBlob.includes(c));
  if (co) return { ok: true, reason: `name + company "${co}"` };
  // Corroborator 2 — the candidate is in Illinois AND the founder has an IL tie.
  if (facts.ilTie && /\b(chicago|illinois|\bil\b|evanston|champaign|urbana|naperville)\b/i.test(gh.location || '')) {
    return { ok: true, reason: `name + IL location "${gh.location}"` };
  }
  // Corroborator 3 — the candidate's blog/bio links back to their own name or site
  // that the founder record also has (a self-referential cross-link).
  if (gh.blog && facts.nameNorm && norm(gh.blog).includes(facts.nameNorm.replace(/ /g, ''))) {
    return { ok: true, reason: `name + personal site` };
  }
  return { ok: false, reason: 'name only — no corroborator' };
}

async function resolveOne(founder, token) {
  const q = encodeURIComponent(`${founder.name} in:name type:user`);
  const search = await ghGet(`/search/users?q=${q}&per_page=5`, token);
  const items = (search.data && search.data.items) || [];
  for (const it of items.slice(0, 5)) {
    const prof = await ghGet(`/users/${it.login}`, token);
    const gh = prof.data;
    if (!gh || !gh.login) continue;
    const c = corroborate(founder, gh);
    if (c.ok) return { url: `https://github.com/${gh.login}`, login: gh.login, reason: c.reason };
    await new Promise((r) => setTimeout(r, 150));
  }
  return null;
}

// Batch: resolve GitHub for pool founders who have none, only accepting corroborated
// matches. Stores how it matched (github_resolve_reason) for auditability.
async function resolveGithubHandles({ userId = 1, token, limit = 30 } = {}) {
  const rows = db.prepare(`
    SELECT id, name, company, previous_company_norm, chicago_connection, location_city,
           linkedin_data, enriched_data, raw_data
    FROM sourced_founders
    WHERE user_id = ? AND status IN ('pending','starred')
      AND (github_url IS NULL OR github_url = '')
      AND github_resolve_reason IS NULL
      AND LENGTH(name) >= 5 AND name LIKE '% %'
    ORDER BY created_at DESC
    LIMIT ?
  `).all(userId, limit);

  const out = { considered: 0, resolved: 0, unresolved: 0, examples: [] };
  const setUrl = db.prepare('UPDATE sourced_founders SET github_url = ?, github_resolve_reason = ? WHERE id = ?');
  const setNone = db.prepare("UPDATE sourced_founders SET github_resolve_reason = 'none' WHERE id = ?");

  for (const f of rows) {
    out.considered++;
    let hit = null;
    try { hit = await resolveOne(f, token); } catch { /* skip on error, retry next run */ continue; }
    if (hit) {
      setUrl.run(hit.url, hit.reason, f.id);
      out.resolved++;
      if (out.examples.length < 15) out.examples.push(`${f.name} → ${hit.login} (${hit.reason})`);
    } else {
      setNone.run(f.id);           // remember we looked, so we don't re-search every run
      out.unresolved++;
    }
    await new Promise((r) => setTimeout(r, 250));
  }
  return out;
}

module.exports = { resolveGithubHandles, __test: { nameMatches, corroborate, founderFacts } };
