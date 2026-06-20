# Using Stu

Stu is a sourcing + talent intelligence tool. It's **free with an account** — there's no
paywall. You bring your own API keys, so any usage that costs money is billed to *you*,
never to the platform. (Today it's shared with portfolio founders and a few VC friends.)

## 1. Get access

1. Create an account at [stu.vc](https://stu.vc) (or ask Danny for an invite link).
2. That's it — every feature is open to any account.

## 2. Add your API keys (one-time)

Open **Settings → API Keys** and paste:

| Key | Needed for | Where to get it |
|---|---|---|
| **Anthropic** | AI scoring, assessments, the chat assistant | console.anthropic.com |
| **Exa** (optional) | Running the sourcing engine to discover new founders/talent | exa.ai |
| **GitHub token** (optional) | Builder/commit signals | github.com → settings → tokens |

Your keys are **encrypted at rest** and never shown back to you or sent to the platform.
Searching and filtering what's already in your account is free and needs no key — keys are
only used when you actively run sourcing or an AI feature, and a daily spend cap protects
you from runaway usage.

## 3. Find unicorn builders with signal filters

Both **Talent** (hiring) and **Sourcing** (founders) can be filtered by high-signal
"unicorn builder" profile types:

| Signal | What it catches |
|---|---|
| `just_departed` | Recently left a company — optionally only YC or a unicorn factory ("YC founder just left") |
| `stealth_building` | "Stealth" / "building something new" in their bio |
| `founder_factory_alum` | Early/founding employee at a breakout (OpenAI, Stripe, Ramp…) |
| `repeat_founder` | Founded before, often with an exit |
| `breakout_builder` | OSS maintainer / build-in-public / strong GitHub activity |
| `credentialed_outlier` | Thiel Fellow, top PhD, olympiad medalist, 30u30 |
| `fresh_incorporation` | Just incorporated (earliest founder signal) |

**Starting from empty?** You don't have to run a big sweep first. Ask Stu (in the app or
from your agent) to **discover** by signal — e.g. "find YC founders who just left" — and it
pulls fresh people from the web in seconds and saves them to your account. (Uses your Exa key.)

## 4. Get alerts (monitors)

Create a **monitor** to be alerted when a signal fires — e.g. a `yc_departure` monitor
tells you when a YC founder just left. Monitors run daily and collect hits you can review
in the app or pull from your agent.

## 5. Connect your own agent (MCP)

Stu speaks **MCP** (Model Context Protocol), so Claude Desktop, Cursor, or any MCP client
can drive it directly. See [mcp-quickstart.md](mcp-quickstart.md).
