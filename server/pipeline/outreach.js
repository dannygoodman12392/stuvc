/**
 * outreach.js — draft a warm, personalized outreach message to a discovered person.
 * Closes the loop: find a unicorn builder → reach out in seconds, in a relational voice
 * (not a templated blast). Uses the user's own Anthropic key (metered).
 */
const { anthropicFor, MODEL } = require('../lib/providerKeys');

class NoKeyError extends Error {
  constructor() { super('Add your Anthropic API key in Settings to draft outreach — it bills your account, not the platform.'); this.code = 'no_key'; this.status = 400; }
}

const INTENTS = {
  recruit: 'recruiting them to join a startup / portfolio company',
  invest: 'exploring backing them as a pre-seed investor',
  connect: 'starting a genuine relationship and staying in touch',
};

const SYSTEM = `You write outreach the way the best founders and investors do: warm, specific, and short.
Rules:
- 3-5 sentences, one short paragraph. Never more.
- Open with a specific, genuine reason you're reaching out — reference something real about them.
- Exactly one soft, low-pressure ask (a quick chat, not a hard sell).
- Sound like a person, not a template. No "I hope this email finds you well", no buzzwords, no flattery inflation.
- Match the requested voice if one is given.
Return ONLY the message text.`;

async function draftOutreach(userId, { person = {}, intent = 'connect', context = '', channel = 'email', voice = '', deps = {} } = {}) {
  const client = deps.client || anthropicFor(userId, 'outreach');
  if (!client) throw new NoKeyError();

  const p = {
    name: person.name || null,
    headline: person.headline || null,
    company: person.company || person.current_company || null,
    role: person.role || person.current_role || null,
    why: person.why || null,
    summary: person.summary || null,
    signals: (person.matched_signals || []).map(s => s.label || s.key),
  };

  const prompt = `Draft a ${channel} outreach message. Goal: ${INTENTS[intent] || intent}.
${context ? `Context the sender wants reflected: ${context}\n` : ''}${voice ? `Write in this voice: ${voice}\n` : ''}Person:
${JSON.stringify(p, null, 1)}

${channel === 'email' ? 'Include a short subject line on the first line as "Subject: ...", then the body.' : 'No subject line.'}
Return ONLY the message.`;

  const resp = await client.messages.create({
    model: MODEL, max_tokens: 800, system: SYSTEM,
    messages: [{ role: 'user', content: prompt }],
  });
  return { message: (resp.content?.[0]?.text || '').trim(), intent, channel };
}

module.exports = { draftOutreach, NoKeyError, INTENTS };
