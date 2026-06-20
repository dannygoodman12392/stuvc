/**
 * http.js — mounts the MCP protocol endpoint at POST /mcp.
 *
 * Stateless Streamable-HTTP: a fresh McpServer + transport per request, bound to the
 * user behind the Bearer MCP token. No session storage, which suits short tool calls
 * and keeps multi-tenant isolation trivial (nothing shared between requests).
 */
const { StreamableHTTPServerTransport } = require('@modelcontextprotocol/sdk/server/streamableHttp.js');
const { buildMcpServer } = require('./server');
const { verifyToken } = require('../lib/mcpAuth');

function unauthorized(res) {
  res.status(401)
    .set('WWW-Authenticate', 'Bearer realm="Stu MCP"')
    .json({ jsonrpc: '2.0', error: { code: -32001, message: 'Unauthorized — provide a valid Stu MCP token as a Bearer credential.' }, id: null });
}

function bearer(req) {
  const h = req.headers.authorization || '';
  if (h.startsWith('Bearer ')) return h.slice(7).trim();
  if (req.headers['x-mcp-token']) return String(req.headers['x-mcp-token']).trim();
  return null;
}

async function handlePost(req, res) {
  const auth = verifyToken(bearer(req));
  if (!auth) return unauthorized(res);

  const server = buildMcpServer({ userId: auth.userId, scopes: auth.scopes });
  const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined });
  res.on('close', () => { try { transport.close(); } catch {} try { server.close(); } catch {} });
  try {
    await server.connect(transport);
    await transport.handleRequest(req, res, req.body);
  } catch (e) {
    if (!res.headersSent) {
      res.status(500).json({ jsonrpc: '2.0', error: { code: -32603, message: 'Internal error: ' + e.message }, id: null });
    }
  }
}

// Stateless mode does not support server-initiated streams or session teardown.
function methodNotAllowed(req, res) {
  res.status(405)
    .set('Allow', 'POST')
    .json({ jsonrpc: '2.0', error: { code: -32000, message: 'Method not allowed. Stu MCP is stateless — use POST.' }, id: null });
}

function mountMcp(app, rateLimiter) {
  const path = '/mcp';
  if (rateLimiter) app.use(path, rateLimiter);
  app.post(path, handlePost);
  app.get(path, methodNotAllowed);
  app.delete(path, methodNotAllowed);
}

module.exports = { mountMcp };
