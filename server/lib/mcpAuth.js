/**
 * mcpAuth.js — issue and verify MCP access tokens.
 *
 * MCP tokens are long-lived but revocable, separate from the 7-day web JWT. They let a
 * user connect their own agent (Claude Desktop, Cursor, a script) to Stu's Talent tools.
 * We store only a SHA-256 hash; the plaintext token is shown exactly once at creation.
 * A token maps to its owner's user_id → all MCP queries are scoped to that user, and any
 * metered work is billed to that user's keys (see providerKeys.js).
 */
const crypto = require('crypto');
const db = require('../db');

const TOKEN_PREFIX = 'stu_mcp_';
const VALID_SCOPES = ['talent:read', 'talent:write', 'sourcing:read', 'monitors'];
const DEFAULT_SCOPES = ['talent:read', 'sourcing:read', 'monitors'];

function hashToken(raw) {
  return crypto.createHash('sha256').update(raw).digest('hex');
}

function sanitizeScopes(scopes) {
  const arr = Array.isArray(scopes) ? scopes : DEFAULT_SCOPES;
  const clean = arr.filter(s => VALID_SCOPES.includes(s));
  return clean.length ? clean : DEFAULT_SCOPES;
}

// Returns { id, token (plaintext — show once), scopes, label }.
function issueToken(userId, label = null, scopes = DEFAULT_SCOPES) {
  const raw = TOKEN_PREFIX + crypto.randomBytes(24).toString('hex');
  const scopeStr = sanitizeScopes(scopes).join(',');
  const info = db.prepare(
    'INSERT INTO mcp_tokens (user_id, token_hash, label, scopes) VALUES (?, ?, ?, ?)'
  ).run(userId, hashToken(raw), label, scopeStr);
  return { id: info.lastInsertRowid, token: raw, scopes: scopeStr.split(','), label };
}

// Returns { userId, scopes: string[], tokenId } or null. Updates last_used_at on success.
function verifyToken(raw) {
  if (!raw || typeof raw !== 'string' || !raw.startsWith(TOKEN_PREFIX)) return null;
  const row = db.prepare(
    'SELECT id, user_id, scopes FROM mcp_tokens WHERE token_hash = ? AND revoked_at IS NULL'
  ).get(hashToken(raw));
  if (!row) return null;
  db.prepare('UPDATE mcp_tokens SET last_used_at = CURRENT_TIMESTAMP WHERE id = ?').run(row.id);
  return { userId: row.user_id, scopes: (row.scopes || '').split(',').filter(Boolean), tokenId: row.id };
}

function listTokens(userId) {
  return db.prepare(
    'SELECT id, label, scopes, created_at, last_used_at, revoked_at FROM mcp_tokens WHERE user_id = ? ORDER BY created_at DESC'
  ).all(userId);
}

function revokeToken(userId, tokenId) {
  const info = db.prepare(
    'UPDATE mcp_tokens SET revoked_at = CURRENT_TIMESTAMP WHERE id = ? AND user_id = ? AND revoked_at IS NULL'
  ).run(tokenId, userId);
  return info.changes > 0;
}

function hasScope(scopes, needed) {
  return Array.isArray(scopes) && scopes.includes(needed);
}

module.exports = {
  TOKEN_PREFIX, VALID_SCOPES, DEFAULT_SCOPES,
  issueToken, verifyToken, listTokens, revokeToken, hasScope,
};
