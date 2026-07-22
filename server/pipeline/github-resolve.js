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

// Pull the founder's corroborating facts. Companies ONLY — schools are deliberately
// excluded, because a shared university ("Brown") is common to thousands and is not
// evidence that two accounts are the same person. That over-trust produced the
// Eric Xia → rkique match on "brown university" alone.
function founderFacts(row) {
  const companies = [];
  for (const blob of [row.linkedin_data, row.enriched_data, row.raw_data]) {
    if (typeof blob === 'string' && blob) {
      try {
        const o = JSON.parse(blob);
        for (const e of o.experiences || []) if (e && e.company) companies.push(e.company);
      } catch { /* free text */ }
    }
  }
  companies.push(row.company, row.previous_company_norm);
  const nm = norm(row.name);
  return {
    companies: [...new Set(companies.filter(Boolean).map(norm))]
      // A company corroborator must be specific (≥5 chars), not a generic word, and
      // NOT a fragment of the founder's own name — "morr" ⊂ "morris" is the person's
      // surname leaking into the company field, not independent evidence.
      .filter((c) => c.length >= 5 && !nm.includes(c) && !c.includes(nm.split(' ').pop())),
    ilTie: /\b(chicago|illinois|evanston|champaign|urbana|naperville|uiuc|northwestern|uchicago)\b/i.test(
      [row.chicago_connection, row.location_city].filter(Boolean).join(' ')
    ),
    nameNorm: nm,
  };
}

// Is the GitHub LOGIN itself derived from the person's full name? "mfigdore" for Matt
// Figdore, "demetrimorris" for Demetri Morris, "chrisgeo" for Chris George. A handle
// built from a real first+last is strong, independent evidence the account is theirs —
// far stronger than a shared school. Requires the (distinctive) LAST name present.
function handleDerivedFromName(login, name) {
  if (!login) return false;
  const t = tokens(name);
  if (t.length < 2) return false;
  const first = t[0], last = t[t.length - 1];
  if (first.length < 3 || last.length < 4) return false; // too short → collides
  const h = login.toLowerCase();
  // Require BOTH the full first AND full last name in the handle. "Benmonahan03" for
  // Ben Monahan passes; "smillerc" for the very common "Sam Miller" does NOT (no
  // "sam") — and it shouldn't, because a first-initial handle on a common name is
  // exactly where this false-matches. Precision over recall: a missed match just
  // means the founder ranks on other signals; a false one hands away someone's slope.
  return h.includes(first) && h.includes(last);
}

// Score one GitHub candidate. ok only on a full-name match AND one STRONG independent
// corroborator: a specific shared company, a name-derived handle, an IL location for
// an IL-tied founder, or a personal site carrying their name.
function corroborate(founder, gh) {
  const ghName = gh.name || gh.login;
  if (!nameMatches(founder.name, ghName)) return { ok: false };
  const facts = founderFacts(founder);
  const ghBlob = norm([gh.company, gh.bio, gh.location, gh.blog].filter(Boolean).join(' '));

  const co = facts.companies.find((c) => ghBlob.includes(c));
  if (co) return { ok: true, reason: `name + company "${co}"` };
  if (handleDerivedFromName(gh.login, founder.name)) return { ok: true, reason: `name-derived handle @${gh.login}` };
  if (facts.ilTie && /\b(chicago|illinois|\bil\b|evanston|champaign|urbana|naperville)\b/i.test(gh.location || '')) {
    return { ok: true, reason: `name + IL location "${gh.location}"` };
  }
  if (gh.blog && facts.nameNorm && norm(gh.blog).includes(facts.nameNorm.replace(/ /g, ''))) {
    return { ok: true, reason: `name + personal site` };
  }
  return { ok: false, reason: 'name only — no strong corroborator' };
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
async function resolveGithubHandles({ userId = 1, token, limit = 30, reset = false } = {}) {
  // reset clears PRIOR resolver writes (url + reason + the slope derived from them) so
  // a tightened matcher can re-decide from scratch. Targeted: only rows the resolver
  // itself touched (github_resolve_reason set) — backfill/discovery URLs are untouched.
  if (reset) {
    db.prepare(`UPDATE sourced_founders SET github_url = NULL, github_slope_score = NULL, github_slope_data = NULL,
                github_resolve_reason = NULL WHERE user_id = ? AND github_resolve_reason IS NOT NULL AND github_resolve_reason != 'none'`).run(userId);
    db.prepare(`UPDATE sourced_founders SET github_resolve_reason = NULL WHERE user_id = ? AND github_resolve_reason = 'none'`).run(userId);
  }
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
