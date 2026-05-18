'use strict';
/**
 * Shared admin-session HMAC token helpers.
 *
 * Tokens are issued by /api/admin-login on successful password
 * authentication and verified by every protected endpoint via the
 * Authorization: Bearer <token> header.
 *
 * Format:  base64url(payload).base64url(hmac-sha256(payload, SECRET))
 *   payload = { exp: <unix-seconds> }
 *
 * Env vars (set in Vercel → Project → Settings → Environment Variables):
 *   ADMIN_PASSWORD          required — the password operators type at login
 *   ADMIN_SESSION_SECRET    required — at least 32 random bytes (hex/base64);
 *                                      used to sign session tokens
 *
 * If either is missing the endpoints will return 500.
 */

const crypto = require('crypto');

const SECRET = process.env.ADMIN_SESSION_SECRET || '';
const TTL_HOURS = parseInt(process.env.ADMIN_SESSION_TTL_HOURS || '12', 10);

function b64url(buf) {
  return Buffer.from(buf).toString('base64')
    .replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function b64urlDecode(s) {
  s = String(s).replace(/-/g, '+').replace(/_/g, '/');
  while (s.length % 4) s += '=';
  return Buffer.from(s, 'base64');
}

function safeEq(a, b) {
  const ab = Buffer.from(String(a));
  const bb = Buffer.from(String(b));
  if (ab.length !== bb.length) return false;
  try { return crypto.timingSafeEqual(ab, bb); } catch { return false; }
}

function isConfigured() { return !!SECRET; }

function issueToken(extraClaims) {
  if (!SECRET) throw new Error('ADMIN_SESSION_SECRET not configured');
  const exp = Math.floor(Date.now() / 1000) + TTL_HOURS * 3600;
  const payload = b64url(JSON.stringify(Object.assign({ exp }, extraClaims || {})));
  const sig = b64url(crypto.createHmac('sha256', SECRET).update(payload).digest());
  return { token: `${payload}.${sig}`, expires_at: new Date(exp * 1000).toISOString() };
}

function verifyToken(token) {
  if (!SECRET || !token) return null;
  const parts = String(token).split('.');
  if (parts.length !== 2) return null;
  const [payload, sig] = parts;
  const expected = b64url(crypto.createHmac('sha256', SECRET).update(payload).digest());
  if (!safeEq(sig, expected)) return null;
  let parsed;
  try { parsed = JSON.parse(b64urlDecode(payload).toString('utf8')); }
  catch { return null; }
  if (typeof parsed.exp !== 'number' || parsed.exp < Math.floor(Date.now() / 1000)) return null;
  return parsed;
}

/* Header parser — accepts either "Authorization: Bearer X" or "X-Admin-Token: X" */
function getTokenFromReq(req) {
  const auth = req.headers['authorization'] || '';
  if (auth.startsWith('Bearer ')) return auth.slice(7).trim();
  const x = req.headers['x-admin-token'];
  if (x) return String(x).trim();
  return '';
}

function requireAdmin(req, res) {
  if (!isConfigured()) {
    res.status(500).json({ error: 'Auth not configured (ADMIN_SESSION_SECRET missing)' });
    return false;
  }
  const tok = getTokenFromReq(req);
  if (!verifyToken(tok)) {
    res.status(401).json({ error: 'Unauthorised — sign in again' });
    return false;
  }
  return true;
}

module.exports = { isConfigured, issueToken, verifyToken, getTokenFromReq, requireAdmin };
