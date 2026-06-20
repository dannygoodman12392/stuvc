# Connect your agent to Stu (MCP)

Stu exposes a **Model Context Protocol** server so you can drive your Talent & Sourcing
data from your own agent (Claude Desktop, Cursor, a script). Search is free; anything that
costs money runs on the keys you added in Settings and is billed to you.

## 1. Create a token

In **Settings → API & MCP Access**, click **Create token**. Copy it now — it's shown once.
(Or `POST /api/mcp/tokens` with your web session.) Revoke anytime from the same screen.

## 2. Point your client at the endpoint

- **Endpoint:** `https://stu.vc/mcp` (transport: streamable HTTP, stateless)
- **Auth:** send the token as a Bearer credential — `Authorization: Bearer stu_mcp_…`

**Claude Desktop / Cursor** (remote MCP over HTTP):

```json
{
  "mcpServers": {
    "stu": {
      "url": "https://stu.vc/mcp",
      "headers": { "Authorization": "Bearer stu_mcp_YOUR_TOKEN" }
    }
  }
}
```

`GET /api/mcp/info` (web session) returns the live endpoint URL, your scopes, the tool
list, and the full signal/monitor catalog.

## 3. Tools

| Tool | What it does |
|---|---|
| `discover_builders` | **Go find new people from the web** by signal (e.g. YC founders who just left). Returns them **ranked, scored (0-100), and explained**. Works on an empty account — best first call. Uses your Exa + Anthropic keys. |
| `draft_outreach` | Write a warm, personalized outreach message to a person (recruit / invest / connect). Closes the loop from find → contact. Uses your Anthropic key. |
| `enrich_profile` | Deep-dive one saved person: clean fields, trajectory summary, one-line "why", 0-100 unicorn score. Uses your Anthropic key. |
| `list_builder_signals` | The filterable unicorn-builder signal types |
| `search_talent_candidates` | Search your candidates; filter by `signals` (e.g. `["just_departed"]`) |
| `get_talent_candidate` | Full detail on one candidate + matched signals |
| `list_talent_roles` / `get_role_matches` | Your open roles and their candidate matches |
| `search_sourced_founders` | Search your sourced-founder queue; filter by signals |
| `list_monitor_types` / `create_monitor` | See and create alerts (e.g. `yc_departure`) |
| `list_monitors` / `list_monitor_hits` / `run_monitors_now` | Manage and read your alerts |

## 4. Try it (works even on a brand-new, empty account)

> "Find me YC founders who just left their company."

→ your agent calls `discover_builders` with `signals: ["just_departed"]` — it pulls fresh
people from the web, saves them to your account, and returns them. No setup beyond an Exa key.

> "Now search the ones I've saved who came from a unicorn factory."

→ `search_sourced_founders` with `signals: ["founder_factory_alum"]` (local, free).

> "Set up a daily alert for YC departures and make it actively discover new ones."

→ `create_monitor` (`type: "yc_departure"`, `config: { active: true }`) → it discovers
fresh departures every day → `list_monitor_hits` to read them.

**Empty account?** That's fine — `discover_builders` fetches new people from the web, so
you get results on your very first ask. `search_*` tools look only at what you've saved;
if they're empty they'll tell you to run `discover_builders`.

## Scopes

Tokens are scoped: `talent:read`, `sourcing:read`, `monitors`. A `talent:read`-only token
won't even see the sourcing or monitor tools in `tools/list`. Default grants all three.

## Notes

- Every query is scoped to **your** data. The MCP surface cannot reach anyone else's data,
  nor the owner's private founder pipeline, assessments, or notes.
- Stateless: each call is independent, authenticated by your token.
