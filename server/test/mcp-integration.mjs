// Standalone integration test (run directly, not under node --test): boots a minimal
// Express app with the real MCP endpoint + routes, seeds unicorn-builder profiles, and
// drives it with a real MCP client. Verifies tools, signal filtering, scope gating,
// auth, and the monitor flow end-to-end.
import { createRequire } from 'module';
const require = createRequire(import.meta.url);

// Safety: this script writes test rows, so refuse to touch the real database.
if (!process.env.DATABASE_PATH) {
  console.error('Refusing to run: set DATABASE_PATH to a throwaway file.\n  e.g. DATABASE_PATH=$(mktemp) node test/mcp-integration.mjs');
  process.exit(1);
}

const express = require('express');
const db = require('../db');
const { issueToken } = require('../lib/mcpAuth');
const { mountMcp } = require('../mcp/http');

let passed = 0, failed = 0;
const ok = (name, cond) => { if (cond) { passed++; console.log('  ✔', name); } else { failed++; console.log('  �’✗ FAIL:', name); } };

// ── Seed a member user (id=2) with a mix of profiles ──
db.prepare("INSERT OR IGNORE INTO users (id,email,name,role,password_hash) VALUES (2,'founder@x.com','Founder','member','h')").run();
const insC = db.prepare(`INSERT INTO talent_candidates (user_id,name,headline,builder_signals,departure_recency_months,overall_score,status) VALUES (2,?,?,?,?,?, 'new')`);
insC.run('Factory Alum', 'Founding Engineer at Stripe', '[]', null, 90);
insC.run('YC Leaver', 'ex-Founder, building something new', '["YC Alum"]', 2, 85);
insC.run('Noise PM', 'Marketing Manager at a Bank', '[]', null, 50);
const insS = db.prepare(`INSERT INTO sourced_founders (user_id,name,company,role,headline,source,status,caliber_score,builder_signals) VALUES (2,?,?,?,?,'test','pending',?,?)`);
insS.run('Stealth Founder', 'Stealth', 'Founder', 'Stealth, building something new', 8, '[]');

db.prepare("INSERT OR IGNORE INTO user_settings (user_id,setting_key,setting_value) VALUES (2,'api_key_exa','exa-test-key')").run();
const fullToken = issueToken(2, 'full', ['talent:read', 'sourcing:read', 'monitors']).token;
const readToken = issueToken(2, 'readonly', ['talent:read']).token;

// ── Minimal app: MCP endpoint + REST routes with a test auth shim (user 2) ──
const app = express();
app.use(express.json());
mountMcp(app, null);
const asUser2 = (req, _res, next) => { req.user = { id: 2 }; next(); };
app.use('/api/mcp', asUser2, require('../routes/mcp'));
app.use('/api/monitors', asUser2, require('../routes/monitors'));
const server = app.listen(0);
const port = server.address().port;
const base = `http://127.0.0.1:${port}`;

const { Client } = require('@modelcontextprotocol/sdk/client/index.js');
const { StreamableHTTPClientTransport } = require('@modelcontextprotocol/sdk/client/streamableHttp.js');

async function mkClient(token) {
  const transport = new StreamableHTTPClientTransport(new URL(`${base}/mcp`), {
    requestInit: { headers: { Authorization: `Bearer ${token}` } },
  });
  const client = new Client({ name: 'test', version: '1.0.0' });
  await client.connect(transport);
  return client;
}
const textOf = (r) => (r.content || []).map(c => c.text).join('\n');

try {
  // 1. Handshake + tools/list (full scope)
  const c = await mkClient(fullToken);
  const tools = (await c.listTools()).tools.map(t => t.name);
  ok('handshake + tools/list returns tools', tools.length > 0);
  ok('exposes search_talent_candidates', tools.includes('search_talent_candidates'));
  ok('exposes monitor tools with monitors scope', tools.includes('create_monitor') && tools.includes('list_monitor_hits'));

  // 2. Signal filter: founder_factory_alum → Factory Alum, not Noise PM
  const fa = textOf(await c.callTool({ name: 'search_talent_candidates', arguments: { signals: ['founder_factory_alum'] } }));
  ok('founder_factory_alum surfaces the Stripe founding engineer', fa.includes('Factory Alum'));
  ok('founder_factory_alum excludes noise', !fa.includes('Noise PM'));

  // 3. just_departed → YC Leaver
  const jd = textOf(await c.callTool({ name: 'search_talent_candidates', arguments: { signals: ['just_departed'] } }));
  ok('just_departed surfaces the recent leaver', jd.includes('YC Leaver'));

  // 4. sourcing search by stealth signal
  const st = textOf(await c.callTool({ name: 'search_sourced_founders', arguments: { signals: ['stealth_building'] } }));
  ok('stealth_building surfaces the stealth founder', st.includes('Stealth Founder'));

  // 5. catalog tool
  const cat = textOf(await c.callTool({ name: 'list_builder_signals', arguments: {} }));
  ok('list_builder_signals returns the taxonomy', cat.includes('just_departed') && cat.includes('founder_factory_alum'));
  await c.close();

  // 6. Scope gating: read-only token must NOT see monitor or sourcing tools
  const rc = await mkClient(readToken);
  const rtools = (await rc.listTools()).tools.map(t => t.name);
  ok('talent:read token hides monitor tools', !rtools.includes('create_monitor'));
  ok('talent:read token hides sourcing tool', !rtools.includes('search_sourced_founders'));
  ok('talent:read token still has talent search', rtools.includes('search_talent_candidates'));
  await rc.close();

  // 7. Auth: no token → 401
  const noAuth = await fetch(`${base}/mcp`, {
    method: 'POST', headers: { 'Content-Type': 'application/json', Accept: 'application/json, text/event-stream' },
    body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 'x', version: '1' } } }),
  });
  ok('missing token → 401', noAuth.status === 401);

  // 8. REST connection info for new users
  const info = await (await fetch(`${base}/api/mcp/info`)).json();
  ok('GET /api/mcp/info has mcpUrl + tools + signals', !!info.mcpUrl && info.tools.length > 0 && info.builderSignals.length >= 6);

  // 9. Monitor flow: create yc_departure, run, read hits
  const created = await (await fetch(`${base}/api/monitors`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ type: 'yc_departure' }) })).json();
  ok('create yc_departure monitor', !!created.id && created.type === 'yc_departure');
  const ran = await (await fetch(`${base}/api/monitors/run`, { method: 'POST' })).json();
  const newHits = ran.results.reduce((s, r) => s + (r.newHits || 0), 0);
  ok('monitor run finds the YC leaver', newHits >= 1);
  const hits = await (await fetch(`${base}/api/monitors/hits`)).json();
  ok('hits list includes the YC leaver with intent', hits.some(h => h.entity_name === 'YC Leaver' && h.intent));

  // 10. invalid monitor type rejected
  const bad = await fetch(`${base}/api/monitors`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ type: 'not_a_type' }) });
  ok('invalid monitor type → 400', bad.status === 400);

  // 11. (regression H2) re-running the monitor must NOT re-alert the same entity
  const rerun = await (await fetch(`${base}/api/monitors/run`, { method: 'POST' })).json();
  const reNew = rerun.results.reduce((s, r) => s + (r.newHits || 0), 0);
  ok('monitor re-run dedups (0 new hits)', reNew === 0);

  // 12. (regression C1) an encrypted gmail app password is decrypted by the consumer
  const secrets = require('../lib/secrets');
  const { loadNewsletterConfig } = require('../services/newsletter');
  db.prepare("INSERT INTO user_settings (user_id, setting_key, setting_value) VALUES (2, 'newsletter_gmail_app_password', ?)")
    .run(secrets.encrypt('app pass 1234'));
  ok('encrypted gmail app password decrypts for the IMAP consumer',
    loadNewsletterConfig(2).appPassword === 'apppass1234'); // spaces stripped by the loader

  // 13. (Phase 4) active discovery — find NEW people from the web (mocked Exa, no network)
  const { discover, NoKeyError } = require('../pipeline/discovery-engine');
  const fakeExa = async () => ({ results: [
    { title: 'Jane Departed - ex-Founder at a YC startup | LinkedIn', url: 'https://www.linkedin.com/in/janedeparted', text: 'Recently left to start building something new. Former founder, Y Combinator alum.' },
    { title: 'Acme Corp Careers', url: 'https://acme.com/jobs', text: 'We are hiring engineers.' }, // noise
  ] });
  const disc = await discover({ userId: 2, signals: ['just_departed'], target: 'sourcing', deps: { exaSearch: fakeExa } });
  ok('discovery finds the departed founder from the web', disc.matched.some(m => m.name === 'Jane Departed'));
  ok('discovery filters out non-person noise', !disc.matched.some(m => /Acme Corp/i.test(m.name)));
  ok('discovery persists into the account', disc.persisted >= 1);

  // 14. discovered person is now searchable via MCP (shelf filled)
  const c2 = await mkClient(fullToken);
  const after = textOf(await c2.callTool({ name: 'search_sourced_founders', arguments: { signals: ['just_departed'] } }));
  ok('discovered founder is now in local search', after.includes('Jane Departed'));

  // 15. no-key path → actionable error (a user with no Exa key)
  let noKey = false;
  try { await discover({ userId: 99, signals: ['just_departed'] }); } catch (e) { noKey = e instanceof NoKeyError; }
  ok('discovery without an Exa key throws a clear no-key error', noKey);

  // 16. empty local search returns a hint pointing to discovery
  const emptyRes = JSON.parse(textOf(await c2.callTool({ name: 'search_talent_candidates', arguments: { signals: ['credentialed_outlier'] } })));
  ok('empty signal search hints at discover_builders', emptyRes.count === 0 && /discover_builders/.test(emptyRes.hint || ''));
  await c2.close();

  // 17. (elite) enrichment turns raw profiles into a ranked, scored, explained shortlist
  const { enrichProfiles } = require('../pipeline/enrichment');
  const fakeLLM = { messages: { create: async () => ({ content: [{ text: JSON.stringify([
    { i: 0, name: 'Alpha Builder', company: 'NewCo', role: 'Founder', summary: 'Left X to build.', why: 'Repeat founder with an exit.', unicorn_score: 92, contactability: 'high', confidence: 0.8 },
    { i: 1, name: 'Beta Builder', company: 'OldCo', role: 'Eng', summary: 'Solid IC.', why: 'Less clear founder signal.', unicorn_score: 60, contactability: 'medium', confidence: 0.6 },
  ]) }] }) } };
  const enriched = await enrichProfiles(2, [{ name: 'Alpha Builder', matched_signals: [{ key: 'repeat_founder', confidence: 0.7 }] }, { name: 'Beta Builder', matched_signals: [{ key: 'breakout_builder', confidence: 0.5 }] }], { deps: { client: fakeLLM } });
  ok('enrichment scores + ranks (highest unicorn_score first)', enriched[0].name === 'Alpha Builder' && enriched[0].unicorn_score === 92);
  ok('enrichment attaches a one-line why', !!enriched[0].why && enriched[0].enriched === true);

  // 18. discovery with enrichment → results carry scores, persisted with unicorn_score
  const disc2 = await discover({ userId: 2, signals: ['stealth_building'], target: 'sourcing',
    deps: { exaSearch: async () => ({ results: [{ title: 'Stealth Sam - building something new | LinkedIn', url: 'https://www.linkedin.com/in/stealthsam', text: 'stealth, building something new' }] }),
            enrichProfiles: async (uid, profs) => profs.map(p => ({ ...p, unicorn_score: 88, why: 'Stealth, strong signal', summary: 'Building.', enriched: true })) } });
  ok('enriched discovery returns a unicorn score', disc2.enriched && disc2.matched[0].unicorn_score === 88);
  const samRow = db.prepare("SELECT unicorn_score FROM sourced_founders WHERE name = 'Stealth Sam' AND user_id = 2").get();
  ok('discovered person persisted with unicorn_score', samRow && samRow.unicorn_score === 88);

  // 19. outreach drafting (engine, mocked client)
  const { draftOutreach } = require('../pipeline/outreach');
  const draft = await draftOutreach(2, { person: { name: 'Alpha Builder', why: 'Repeat founder' }, intent: 'recruit', deps: { client: { messages: { create: async () => ({ content: [{ text: 'Subject: Quick hello\n\nHi Alpha — saw you left X...' }] }) } } } });
  ok('outreach returns a drafted message', /Alpha/.test(draft.message) && draft.intent === 'recruit');

  // 20. MCP draft_outreach without an Anthropic key → clear, non-crashing error
  const c3 = await mkClient(fullToken);
  const dr = await c3.callTool({ name: 'draft_outreach', arguments: { person: { name: 'X' }, intent: 'connect' } });
  ok('draft_outreach without key returns a clear error (no crash)', dr.isError === true && /Anthropic/i.test(textOf(dr)));
  await c3.close();

} catch (e) {
  failed++; console.log('  ✗ THREW:', e.message, '\n', e.stack);
} finally {
  server.close();
  console.log(`\n${failed === 0 ? 'ALL PASS' : 'FAILURES'}: ${passed} passed, ${failed} failed`);
  process.exit(failed === 0 ? 0 : 1);
}
