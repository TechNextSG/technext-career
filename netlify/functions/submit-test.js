'use strict';
const https = require('https');

const SUPABASE_URL  = process.env.SUPABASE_URL  || 'https://ndaydueegykjvliblbly.supabase.co';
const SUPABASE_ANON = process.env.SUPABASE_ANON_KEY || 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im5kYXlkdWVlZ3lranZsaWJsYmx5Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzIxMDQxMjIsImV4cCI6MjA4NzY4MDEyMn0.BwRzuNbMSj1b1B3eSYP1R9Y2a0SnkewxhtqTFIjJfzg';

const CORS = {
  'Access-Control-Allow-Origin':  '*',
  'Access-Control-Allow-Headers': 'Content-Type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Content-Type': 'application/json',
};

exports.handler = async function(event) {
  if (event.httpMethod === 'OPTIONS') return { statusCode: 200, headers: CORS, body: '' };
  if (event.httpMethod !== 'POST')   return { statusCode: 405, headers: CORS, body: JSON.stringify({ error: 'Method not allowed' }) };

  let payload;
  try { payload = JSON.parse(event.body); }
  catch(e) { return { statusCode: 400, headers: CORS, body: JSON.stringify({ error: 'Invalid JSON' }) }; }

  const required = ['test_type','candidate_name','start_time','end_time','time_taken_seconds'];
  for (const f of required) {
    if (!payload[f]) return { statusCode: 400, headers: CORS, body: JSON.stringify({ error: `Missing field: ${f}` }) };
  }

  try {
    const row = await supabaseInsert(payload);
    return { statusCode: 200, headers: CORS, body: JSON.stringify({ success: true, id: row.id || null }) };
  } catch(err) {
    console.error('Supabase insert error:', err);
    return { statusCode: 500, headers: CORS, body: JSON.stringify({ error: 'Database error', detail: err.message }) };
  }
};

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
        'apikey':         SUPABASE_ANON,
        'Authorization':  `Bearer ${SUPABASE_ANON}`,
        'Prefer':         'return=representation',
        'Content-Length': Buffer.byteLength(body),
      },
    };
    const req = https.request(opts, res => {
      let raw = '';
      res.on('data', c => raw += c);
      res.on('end', () => {
        try { const arr = JSON.parse(raw); resolve(Array.isArray(arr) ? arr[0] || {} : {}); }
        catch(e) { resolve({}); }
      });
    });
    req.on('error', reject);
    req.write(body);
    req.end();
  });
}
