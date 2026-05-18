'use strict';
const https = require('https');
const { odooSync, isConfigured: odooConfigured } = require('./_odoo');

const SUPABASE_URL = process.env.SUPABASE_URL || '';
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY
                  || process.env.SUPABASE_ANON_KEY
                  || '';

const MAX_PAYLOAD_BYTES = 256 * 1024;        // 256 KB — generous for a test submission
const MAX_FIELD_LEN     = 500;               // truncate any silly long string field
const VALID_TEST_TYPES  = new Set([
  'tn_company_quiz', 'tn_profiler', 'tn_iq',
  'tn_ai_technical', 'tn_fc_technical', 'tn_odoo_technical', 'tn_cyber_technical',
  'tn_booking',
]);
const VALID_ROLES = new Set([
  'ai-engineer', 'functional-consultant', 'odoo-developer', 'cyber-security', '',
]);

// Hard deadline on the Odoo sync from the submit handler. The candidate's UX
// must not wait longer than this even if Odoo hangs.
const ODOO_SYNC_TIMEOUT_MS = parseInt(process.env.ODOO_SYNC_TIMEOUT_MS || '3500', 10);

module.exports = async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  if (!SUPABASE_URL || !SUPABASE_KEY) {
    return res.status(500).json({ error: 'Server misconfigured' });
  }

  // Vercel parses JSON body automatically when content-type is application/json
  let payload = req.body;
  if (typeof payload === 'string') {
    if (payload.length > MAX_PAYLOAD_BYTES) return res.status(413).json({ error: 'Payload too large' });
    try { payload = JSON.parse(payload); }
    catch { return res.status(400).json({ error: 'Invalid JSON' }); }
  }
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) return res.status(400).json({ error: 'Empty body' });

  // Enforce a payload size ceiling even for already-parsed bodies.
  try {
    const approx = JSON.stringify(payload).length;
    if (approx > MAX_PAYLOAD_BYTES) return res.status(413).json({ error: 'Payload too large' });
  } catch { return res.status(400).json({ error: 'Unserializable body' }); }

  const required = ['test_type', 'candidate_name', 'start_time', 'end_time', 'time_taken_seconds'];
  for (const f of required) {
    if (payload[f] === undefined || payload[f] === null || payload[f] === '') {
      return res.status(400).json({ error: `Missing field: ${f}` });
    }
  }
  if (!VALID_TEST_TYPES.has(String(payload.test_type))) {
    return res.status(400).json({ error: 'Invalid test_type' });
  }
  if (payload.candidate_role != null && !VALID_ROLES.has(String(payload.candidate_role))) {
    return res.status(400).json({ error: 'Invalid candidate_role' });
  }
  // Truncate top-level string fields to defuse log-flooding / oversized writes.
  for (const k of Object.keys(payload)) {
    if (typeof payload[k] === 'string' && payload[k].length > MAX_FIELD_LEN) {
      payload[k] = payload[k].slice(0, MAX_FIELD_LEN);
    }
  }
  // time_taken_seconds must be a reasonable integer.
  const tts = Number(payload.time_taken_seconds);
  if (!Number.isFinite(tts) || tts < 0 || tts > 24 * 3600) {
    return res.status(400).json({ error: 'Invalid time_taken_seconds' });
  }
  payload.time_taken_seconds = Math.round(tts);

  let row;
  try {
    row = await supabaseInsert(payload);
  } catch (err) {
    console.error('Supabase insert error:', err.message);
    return res.status(500).json({ error: 'Database error' }); // no detail leaked
  }

  // Best-effort Odoo mirror. Bounded by a hard timeout. NEVER fails the
  // candidate's submission — Supabase is the source of truth.
  if (odooConfigured()) {
    try {
      await runWithTimeout(odooSync(payload, row.id), ODOO_SYNC_TIMEOUT_MS);
    } catch (err) {
      console.log(JSON.stringify({
        evt: 'odoo_sync_fail',
        t: new Date().toISOString(),
        supabase_id: row.id || null,
        test_type: payload.test_type,
        err: (err && err.message) ? String(err.message).slice(0, 3000) : 'unknown',
      }));
    }
  }

  return res.status(200).json({ success: true, id: row.id || null });
};

function runWithTimeout(promise, ms) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('Odoo sync timeout after ' + ms + 'ms')), ms);
    Promise.resolve(promise).then(
      v => { clearTimeout(timer); resolve(v); },
      e => { clearTimeout(timer); reject(e); }
    );
  });
}

function supabaseInsert(data) {
  return new Promise((resolve, reject) => {
    const body = JSON.stringify(data);
    const url  = new URL('/rest/v1/candidate_results?select=id', SUPABASE_URL);
    const opts = {
      hostname: url.hostname,
      path:     url.pathname + url.search,
      method:   'POST',
      headers: {
        'Content-Type':   'application/json',
        'apikey':         SUPABASE_KEY,
        'Authorization':  `Bearer ${SUPABASE_KEY}`,
        'Prefer':         'return=representation',
        'Content-Length': Buffer.byteLength(body),
      },
    };
    const req = https.request(opts, r => {
      let raw = '';
      r.on('data', c => raw += c);
      r.on('end', () => {
        try {
          const parsed = JSON.parse(raw);
          if (!Array.isArray(parsed) && parsed.code) {
            return reject(new Error(`Supabase ${parsed.code}: ${parsed.message}`));
          }
          resolve(Array.isArray(parsed) ? parsed[0] || {} : {});
        } catch { resolve({}); }
      });
    });
    req.on('error', reject);
    req.write(body);
    req.end();
  });
}
