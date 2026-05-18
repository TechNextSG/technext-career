'use strict';
const https = require('https');
const { requireAdmin } = require('./_auth');

const SUPABASE_URL     = process.env.SUPABASE_URL || '';
const SUPABASE_SVC_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || '';

module.exports = async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization, X-Admin-Token');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Cache-Control', 'no-store');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });

  if (!SUPABASE_URL || !SUPABASE_SVC_KEY) {
    return res.status(500).json({ error: 'Server misconfigured — SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY missing' });
  }

  // Token-based auth — no more passwords on the wire after login.
  if (!requireAdmin(req, res)) return;

  const q = req.query || {};
  const type  = String(q.type  || 'all').slice(0, 64);
  const limit = Math.min(2000, Math.max(1, parseInt(q.limit || '500', 10) || 500));
  const page  = Math.max(1, parseInt(q.page  || '1', 10) || 1);
  // Loose ISO-date validation: YYYY-MM-DD or full ISO; reject anything weird.
  const from  = /^[\d\-T:.Z+]{0,32}$/.test(q.from || '') ? q.from : '';
  const to    = /^[\d\-T:.Z+]{0,32}$/.test(q.to   || '') ? q.to   : '';

  try {
    const rows = await supabaseSelect({ type, limit, page, from, to });
    return res.status(200).json(rows);
  } catch (err) {
    console.error('Supabase select error:', err.message);
    // Do not leak internals to the client.
    return res.status(500).json({ error: 'Database error' });
  }
};

function supabaseSelect({ type, limit, page, from, to }) {
  return new Promise((resolve, reject) => {
    const offset = (page - 1) * limit;
    let path = `/rest/v1/candidate_results?select=*&order=created_at.desc&limit=${limit}&offset=${offset}`;
    if (type && type !== 'all') path += `&test_type=eq.${encodeURIComponent(type)}`;
    if (from) path += `&created_at=gte.${encodeURIComponent(from)}`;
    if (to)   path += `&created_at=lte.${encodeURIComponent(to)}`;

    const url  = new URL(path, SUPABASE_URL);
    const opts = {
      hostname: url.hostname,
      path:     url.pathname + url.search,
      method:   'GET',
      headers: {
        'apikey':        SUPABASE_SVC_KEY,
        'Authorization': `Bearer ${SUPABASE_SVC_KEY}`,
      },
    };
    const r = https.request(opts, resp => {
      let raw = '';
      resp.on('data', c => raw += c);
      resp.on('end', () => {
        try { resolve(JSON.parse(raw)); } catch { resolve([]); }
      });
    });
    r.on('error', reject);
    r.end();
  });
}
