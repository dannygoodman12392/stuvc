/**
 * secrets.js — encryption at rest for user-supplied credentials.
 *
 * Keys (Anthropic / Exa / GitHub / enrichment / app passwords) are stored in
 * user_settings. We encrypt them with AES-256-GCM under a server master key so a
 * leaked database file does not leak every tenant's provider keys.
 *
 * Back-compat: if SETTINGS_ENC_KEY is not configured, encrypt() is a no-op and
 * decrypt() returns the value unchanged — so existing plaintext keys keep working
 * and dev setups need no extra config. Once a master key is set, new writes are
 * encrypted and the one-time migration in db.js encrypts what's already stored.
 */
const crypto = require('crypto');

const ALGO = 'aes-256-gcm';
const PREFIX = 'enc:v1:';

let cachedKey = null;
function getKey() {
  if (cachedKey !== null) return cachedKey || null;
  const raw = process.env.SETTINGS_ENC_KEY;
  if (!raw || !raw.trim()) { cachedKey = false; return null; }
  // Accept a 64-char hex key directly; otherwise derive a 32-byte key from the
  // passphrase via SHA-256 (so any reasonably strong string works).
  cachedKey = /^[0-9a-fA-F]{64}$/.test(raw.trim())
    ? Buffer.from(raw.trim(), 'hex')
    : crypto.createHash('sha256').update(raw, 'utf8').digest();
  return cachedKey;
}

function isConfigured() {
  return getKey() != null;
}

function isEncrypted(value) {
  return typeof value === 'string' && value.startsWith(PREFIX);
}

function encrypt(plaintext) {
  const key = getKey();
  // No master key configured, nothing to encrypt, or already encrypted → pass through.
  if (key == null || plaintext == null || plaintext === '' || isEncrypted(plaintext)) return plaintext;
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv(ALGO, key, iv);
  const ct = Buffer.concat([cipher.update(String(plaintext), 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return PREFIX + Buffer.concat([iv, tag, ct]).toString('base64');
}

function decrypt(value) {
  if (!isEncrypted(value)) return value; // plaintext (legacy or unconfigured) → unchanged
  const key = getKey();
  if (key == null) return null; // ciphertext but no key → fail closed, never echo ciphertext
  try {
    const raw = Buffer.from(value.slice(PREFIX.length), 'base64');
    const iv = raw.subarray(0, 12);
    const tag = raw.subarray(12, 28);
    const ct = raw.subarray(28);
    const decipher = crypto.createDecipheriv(ALGO, key, iv);
    decipher.setAuthTag(tag);
    return Buffer.concat([decipher.update(ct), decipher.final()]).toString('utf8');
  } catch {
    return null; // tampered or wrong key
  }
}

module.exports = { encrypt, decrypt, isEncrypted, isConfigured, PREFIX };
