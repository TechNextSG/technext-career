'use strict';
const https = require('https');

const SUPABASE_URL     = process.env.SUPABASE_URL  || 'https://ndaydueegykjvliblbly.supabase.co';
const SUPABASE_SVC_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || '';
const ADMIN_PASSWORD   = process.env.ADMIN_PASSWORD || 'mustjobs2025';

const CORS = {
  'Access-Control-Allow-Origin':  '*',
  'Access-Control-Allow-Headers': 'Content-Type, x-admin-password',
  'Access-Control-Allow-Methods': 'GET, OPTIONS',
  'Content-Type': 'application/json',
};

exports.handler = async function(event) {
  if (event.httpMethod === 'OPTIONS') return { statusCode: 200, headers: CORS, body: '' };
  if (event.httpMethod !== 'GET')    return { statusCode: 405, headers: CORS, body: JSON.stringify({ error: 'Method not allowed' }) };

  const pwd = (event.headers['x-admin-password'] || event.queryStringParameters?.p || '').trim();
  if (pwd !== ADMIN_PASSWORD) {
    return { statusCode: 401, headers: CORS, body: JSON.stringify({ error: 'Unauthorised' }) };
  }

  if (!SUPABASE_SVC_KEY) {
    return { statusCode: 503, headers: CORS, body: JSON.stringify({ error: 'Service key not configured. Set SUPABASE_SERVICE_ROLE_KEY in Netlify env vars.' }) };
  }

  const type  = event.queryStringParameters?.type  || 'all';
  const limit = parseInt(event.queryStringParameters?.limit || '500');
  const page  = parseInt(event.queryStringParameters?.page  || '1');
  const from  = event.queryStringParameters?.from  || '';
  const to    = event.queryStringParameters?.to    || '';

  try {
    const rows = await supabaseSelect({ type, limit, page, from, to });
    return { statusCode: 200, headers: CORS, body: JSON.stringify(rows) };
  } catch(err) {
    console.error('Supabase select error:', err);
    return { statusCode: 500, headers: CORS, body: JSON.stringify({ error: 'Database error', detail: err.message }) };
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
        'Range-Unit':    'items',
      },
    };
    const req = https.request(opts, res => {
      let raw = '';
      res.on('data', c => raw += c);
      res.on('end', () => {
        try { resolve(JSON.parse(raw)); }
        catch(e) { resolve([]); }
      });
    });
    req.on('error', reject);
    req.end();
  });
}
