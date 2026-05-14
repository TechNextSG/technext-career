'use strict';
const https = require('https');

const SUPABASE_URL = process.env.SUPABASE_URL || 'https://ndaydueegykjvliblbly.supabase.co';
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY
                  || 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im5kYXlkdWVlZ3lranZsaWJsYmx5Iiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc3MjEwNDEyMiwiZXhwIjoyMDg3NjgwMTIyfQ.EalKqjd3OAMLPocKvyatpvbyBxXn73uNErSs55OmZho';
const BUCKET = 'resumes';

module.exports = async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  let body = req.body;
  if (typeof body === 'string') { try { body = JSON.parse(body); } catch { return res.status(400).json({ error: 'Invalid JSON' }); } }
  if (!body || !body.base64 || !body.filename) return res.status(400).json({ error: 'Missing filename or base64' });

  // Strip path-y bits, keep a safe filename + a random prefix to avoid collisions
  const cleanName = String(body.filename).replace(/[^a-zA-Z0-9._-]/g, '_').slice(0, 80);
  const stamp = Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 8);
  const objectPath = `${stamp}__${cleanName}`;

  let buf;
  try { buf = Buffer.from(body.base64, 'base64'); }
  catch { return res.status(400).json({ error: 'Invalid base64' }); }
  if (buf.length > 4.5 * 1024 * 1024) return res.status(413).json({ error: 'File too large (max 4MB)' });

  try {
    await supabaseUpload(objectPath, buf, body.contentType || 'application/octet-stream');
    const url = `${SUPABASE_URL.replace(/\/$/, '')}/storage/v1/object/public/${BUCKET}/${encodeURIComponent(objectPath)}`;
    return res.status(200).json({ success: true, url, path: objectPath });
  } catch (err) {
    console.error('Upload error:', err);
    return res.status(500).json({ error: 'Upload failed', detail: err.message });
  }
};

function supabaseUpload(path, buf, contentType) {
  return new Promise((resolve, reject) => {
    const url = new URL(`/storage/v1/object/${BUCKET}/${encodeURIComponent(path)}`, SUPABASE_URL);
    const req = https.request({
      hostname: url.hostname,
      path: url.pathname,
      method: 'POST',
      headers: {
        'apikey': SUPABASE_KEY,
        'Authorization': `Bearer ${SUPABASE_KEY}`,
        'Content-Type': contentType,
        'x-upsert': 'false',
        'Content-Length': buf.length
      }
    }, r => {
      let raw = '';
      r.on('data', c => raw += c);
      r.on('end', () => {
        if (r.statusCode >= 200 && r.statusCode < 300) return resolve();
        reject(new Error(`Supabase storage ${r.statusCode}: ${raw}`));
      });
    });
    req.on('error', reject);
    req.write(buf);
    req.end();
  });
}
