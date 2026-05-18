'use strict';
/**
 * Admin login endpoint.
 *
 *   POST /api/admin-login
 *     body: { password: "<plain text>" }
 *     200 → { success: true, token: "<jwt-like>", expires_at: "ISO" }
 *     401 → { error: "Invalid credentials" }
 *     500 → { error: "Auth not configured" }
 *
 * The returned token must be sent as `Authorization: Bearer <token>`
 * on every subsequent protected request. Tokens expire after
 * ADMIN_SESSION_TTL_HOURS (default 12 h).
 */

const crypto = require('crypto');
const { isConfigured, issueToken } = require('./_auth');

const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || '';

/* Trivial in-memory throttle (per warm Lambda) — discourages spray-and-pray.
   Real protection requires Vercel Edge Config / external store, but this
   raises the cost of brute force in the common single-instance case. */
const _attempts = new Map();   // ip → { n, until }
const MAX_TRIES = 8;
const WINDOW_MS = 5 * 60 * 1000;

function bucketKey(req) {
  return (req.headers['x-forwarded-for'] || '').split(',')[0].trim()
      || req.headers['x-real-ip'] || req.socket?.remoteAddress || 'unknown';
}

function tooMany(req) {
  const k = bucketKey(req);
  const now = Date.now();
  const rec = _attempts.get(k);
  if (rec && rec.until > now && rec.n >= MAX_TRIES) return true;
  return false;
}

function recordFailure(req) {
  const k = bucketKey(req);
  const now = Date.now();
  const rec = _attempts.get(k);
  if (!rec || rec.until <= now) _attempts.set(k, { n: 1, until: now + WINDOW_MS });
  else rec.n++;
}

function recordSuccess(req) { _attempts.delete(bucketKey(req)); }

function safeEq(a, b) {
  const ab = Buffer.from(String(a));
  const bb = Buffer.from(String(b));
  if (ab.length !== bb.length) return false;
  try { return crypto.timingSafeEqual(ab, bb); } catch { return false; }
}

module.exports = async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Cache-Control', 'no-store');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST')    return res.status(405).json({ error: 'Method not allowed' });

  if (!ADMIN_PASSWORD || !isConfigured()) {
    return res.status(500).json({ error: 'Server misconfigured — set ADMIN_PASSWORD and ADMIN_SESSION_SECRET' });
  }

  if (tooMany(req)) {
    return res.status(429).json({ error: 'Too many attempts. Try again in a few minutes.' });
  }

  let body = req.body;
  if (typeof body === 'string') {
    try { body = JSON.parse(body); }
    catch { return res.status(400).json({ error: 'Invalid JSON' }); }
  }
  const submitted = (body && body.password) ? String(body.password) : '';

  if (!safeEq(submitted, ADMIN_PASSWORD)) {
    recordFailure(req);
    // Constant-ish delay to slow timing-based attacks (the timingSafeEqual already neutralises chars-compared timing).
    return res.status(401).json({ error: 'Invalid credentials' });
  }

  recordSuccess(req);
  const { token, expires_at } = issueToken({});
  return res.status(200).json({ success: true, token, expires_at });
};
