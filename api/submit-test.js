'use strict';
const https = require('https');
const { odooSync, isConfigured: odooConfigured } = require('./_odoo');

const SUPABASE_URL  = process.env.SUPABASE_URL  || 'https://ndaydueegykjvliblbly.supabase.co';
const SUPABASE_KEY  = process.env.SUPABASE_SERVICE_ROLE_KEY
                   || process.env.SUPABASE_ANON_KEY
                   || 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im5kYXlkdWVlZ3lranZsaWJsYmx5Iiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc3MjEwNDEyMiwiZXhwIjoyMDg3NjgwMTIyfQ.EalKqjd3OAMLPocKvyatpvbyBxXn73uNErSs55OmZho';

// Hard deadline on the Odoo sync from the submit handler. The candidate's UX
// must not wait longer than this even if Odoo hangs.
const ODOO_SYNC_TIMEOUT_MS = parseInt(process.env.ODOO_SYNC_TIMEOUT_MS || '3500', 10);

module.exports = async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  // Vercel parses JSON body automatically when content-type is application/json
  let payload = req.body;
  if (typeof payload === 'string') { try { payload = JSON.parse(payload); } catch { return res.status(400).json({ error: 'Invalid JSON' }); } }
  if (!payload) return res.status(400).json({ error: 'Empty body' });

  const required = ['test_type','candidate_name','start_time','end_time','time_taken_seconds'];
  for (const f of required) {
    if (payload[f] === undefined || payload[f] === null || payload[f] === '') {
      return res.status(400).json({ error: `Missing field: ${f}` });
    }
  }

  let row;
  try {
    row = await supabaseInsert(payload);
  } catch (err) {
    console.error('Supabase insert error:', err);
    return res.status(500).json({ error: 'Database error', detail: err.message });
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
        err: (err && err.message) ? String(err.message).slice(0, 240) : 'unknown',
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
