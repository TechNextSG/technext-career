'use strict';
const https = require('https');

const SUPABASE_URL     = process.env.SUPABASE_URL || 'https://ndaydueegykjvliblbly.supabase.co';
const SUPABASE_SVC_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY
                      || 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im5kYXlkdWVlZ3lranZsaWJsYmx5Iiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc3MjEwNDEyMiwiZXhwIjoyMDg3NjgwMTIyfQ.EalKqjd3OAMLPocKvyatpvbyBxXn73uNErSs55OmZho';
const ADMIN_PASSWORD   = process.env.ADMIN_PASSWORD || 'mustjobs2025';

module.exports = async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, x-admin-password');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });

  const pwd = (req.headers['x-admin-password'] || req.query?.p || '').trim();
  if (pwd !== ADMIN_PASSWORD) return res.status(401).json({ error: 'Unauthorised' });

  const q = req.query || {};
  const type  = q.type  || 'all';
  const limit = parseInt(q.limit || '500');
  const page  = parseInt(q.page  || '1');
  const from  = q.from  || '';
  const to    = q.to    || '';

  try {
    const rows = await supabaseSelect({ type, limit, page, from, to });
    return res.status(200).json(rows);
  } catch (err) {
    console.error('Supabase select error:', err);
    return res.status(500).json({ error: 'Database error', detail: err.message });
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
