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
  // The SURNAME must match exactly — no prefix. Allowing prefix in both directions on
  // 2-char tokens matched "Bo Li" to "Bob Livingston" (engineering red team F5). Given
  // names may prefix-match, but only when ≥4 chars ("Chris" ⊂ "Christopher").
  const last = a[a.length - 1];
  if (!b.has(last)) return false;
  return a.slice(0, -1).every((t) =>
    b.has(t) || (t.length >= 4 && [...b].some((x) => x.startsWith(t) || t.startsWith(x))));
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

// A GitHub location that CONTRADICTS the founder's Illinois tie. Confirmed-wrong
// matches were "Emily Wang → Emilywang98 (University of Calgary)" and "Akshay Patel →
// akshaypatel80 (Gujarat, India)": a common name whose handle belongs to someone else,
// somewhere else. An empty, Illinois, or US-generic location is NOT a contradiction; a
// specific other place is.
const US_GENERIC = /\b(remote|usa|u\.?s\.?a?|united states|earth|worldwide|global|anywhere|everywhere|internet)\b/i;
const IL_LOC = /\b(chicago|illinois|\bil\b|evanston|champaign|urbana|naperville|schaumburg|peoria|springfield)\b/i;
function locationContradictsIL(loc) {
  const l = String(loc || '').trim();
  if (!l) return false;                 // no location → no contradiction
  if (IL_LOC.test(l) || US_GENERIC.test(l)) return false;
  return true;                          // a specific, non-IL, non-US-generic place
}

// Score one GitHub candidate. A full-name match is necessary but NEVER sufficient —
// attributing a stranger's slope to a founder is the worst failure this system can
// make. `nameCommon` (from the search result count) is the hinge: for a COMMON name
// a handle alone is worthless (there are hundreds of "emily wang" handles), so it
// requires a real corroborator; for a DISTINCTIVE name a name-derived handle stands,
// as long as the location doesn't contradict.
function corroborate(founder, gh, { nameCommon = false } = {}) {
  const ghName = gh.name || gh.login;
  if (!nameMatches(founder.name, ghName)) return { ok: false };
  const facts = founderFacts(founder);
  const ghBlob = norm([gh.company, gh.bio, gh.location, gh.blog].filter(Boolean).join(' '));

  // A POSITIVE corroborator is REQUIRED — a name match alone (even a name-derived
  // handle) is never enough. Ground truth kept finding the failure: "Jake Taylor →
  // jakewtaylor" is a frontend dev in Suffolk, England; "Emily Wang → Emilywang98" a
  // Calgary student. Both red teams were unequivocal — attributing a stranger's
  // GitHub trajectory to a founder, and possibly citing it in a meeting, is the
  // worst failure this system can make. So: a shared specific company, an affirmative
  // Illinois location, or a personal site carrying their name. Nothing else.
  const co = facts.companies.find((c) => ghBlob.includes(c));
  if (co) return { ok: true, reason: `name + company "${co}"` };
  if (facts.ilTie && IL_LOC.test(gh.location || '')) return { ok: true, reason: `name + IL location "${gh.location}"` };
  if (gh.blog && facts.nameNorm && norm(gh.blog).includes(facts.nameNorm.replace(/ /g, ''))) {
    return { ok: true, reason: `name + personal site` };
  }
  return { ok: false, reason: 'name match but no positive corroborator (company/IL/site)' };
}

// Returns { url, login, reason } on a confident match, null on a genuine no-match, or
// { failed:true } on a fetch error (so the caller doesn't cache a transient blip as a
// permanent 'none' — engineering red team F12).
async function resolveOne(founder, token) {
  const q = encodeURIComponent(`${founder.name} in:name type:user`);
  const search = await ghGet(`/search/users?q=${q}&per_page=5`, token);
  if (search.status !== 200) return { failed: true };   // don't record a no-match on a failed search
  const items = (search.data && search.data.items) || [];
  // total_count is GitHub's own answer to "how many people share this name?" — the
  // commonness signal, straight from the source. >8 accounts named this → a handle
  // alone can't identify the founder.
  const nameCommon = (search.data && search.data.total_count || items.length) > 8;

  // Collect ALL passing candidates rather than taking the first. Ambiguity is
  // disqualifying: if two same-named accounts both pass on a WEAK (handle-only)
  // corroborator, we can't tell which is the founder — refuse (F4). A single lone
  // pass, or a STRONG corroborator (company/IL/site), still resolves.
  const passes = [];
  for (const it of items.slice(0, 5)) {
    const prof = await ghGet(`/users/${it.login}`, token);
    if (prof.status !== 200) return { failed: true };
    const gh = prof.data;
    if (!gh || !gh.login) continue;
    const c = corroborate(founder, gh, { nameCommon });
    if (c.ok) passes.push({ url: `https://github.com/${gh.login}`, login: gh.login, reason: c.reason, strong: !/^name-derived handle/.test(c.reason) });
    await new Promise((r) => setTimeout(r, 150));
  }
  if (!passes.length) return null;
  const strong = passes.filter((p) => p.strong);
  if (strong.length === 1) return strong[0];
  if (strong.length > 1) return null;                   // multiple strong → still ambiguous, refuse
  if (passes.length === 1) return passes[0];            // one lone weak pass is acceptable
  return null;                                          // several weak passes → ambiguous, refuse
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

  const out = { considered: 0, resolved: 0, unresolved: 0, failed: 0, examples: [] };
  const setUrl = db.prepare('UPDATE sourced_founders SET github_url = ?, github_resolve_reason = ? WHERE id = ?');
  const setNone = db.prepare("UPDATE sourced_founders SET github_resolve_reason = 'none' WHERE id = ?");

  for (const f of rows) {
    out.considered++;
    let hit = null;
    try { hit = await resolveOne(f, token); } catch { out.failed++; continue; }
    // A FETCH FAILURE is not a no-match — leave github_resolve_reason NULL so the row
    // is retried next run, rather than caching a transient blip as a permanent 'none'
    // that the WHERE-clause then excludes forever (F12).
    if (hit && hit.failed) { out.failed++; continue; }
    if (hit) {
      setUrl.run(hit.url, hit.reason, f.id);
      out.resolved++;
      if (out.examples.length < 15) out.examples.push(`${f.name} → ${hit.login} (${hit.reason})`);
    } else {
      setNone.run(f.id);           // a genuine no-match: remember, so we don't re-search every run
      out.unresolved++;
    }
    await new Promise((r) => setTimeout(r, 250));
  }
  return out;
}

module.exports = { resolveGithubHandles, __test: { nameMatches, corroborate, founderFacts } };
