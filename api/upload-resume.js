'use strict';
const https = require('https');

const SUPABASE_URL = process.env.SUPABASE_URL || '';
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || '';
const BUCKET = 'resumes';

const MAX_BYTES   = 4.5 * 1024 * 1024;    // 4.5 MB
const ALLOWED_EXT = new Set(['pdf', 'doc', 'docx']);
const ALLOWED_MIME = new Set([
  'application/pdf',
  'application/msword',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
]);

/* Magic-byte sniffing — first ~8 bytes are enough to identify common resume formats. */
function detectMime(buf) {
  if (!buf || buf.length < 4) return null;
  // PDF starts with %PDF-
  if (buf[0] === 0x25 && buf[1] === 0x50 && buf[2] === 0x44 && buf[3] === 0x46) return 'application/pdf';
  // DOC (OLE2 compound): D0 CF 11 E0 A1 B1 1A E1
  if (buf[0] === 0xD0 && buf[1] === 0xCF && buf[2] === 0x11 && buf[3] === 0xE0) return 'application/msword';
  // DOCX (zip) starts with PK\x03\x04
  if (buf[0] === 0x50 && buf[1] === 0x4B && buf[2] === 0x03 && buf[3] === 0x04) {
    return 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';
  }
  return null;
}

module.exports = async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST')    return res.status(405).json({ error: 'Method not allowed' });

  if (!SUPABASE_URL || !SUPABASE_KEY) {
    return res.status(500).json({ error: 'Server misconfigured' });
  }

  let body = req.body;
  if (typeof body === 'string') {
    try { body = JSON.parse(body); }
    catch { return res.status(400).json({ error: 'Invalid JSON' }); }
  }
  if (!body || !body.base64 || !body.filename) {
    return res.status(400).json({ error: 'Missing filename or base64' });
  }

  // Sanitize filename and validate extension.
  const cleanName = String(body.filename).replace(/[^a-zA-Z0-9._-]/g, '_').slice(0, 80);
  const ext = (cleanName.match(/\.([a-zA-Z0-9]+)$/) || [, ''])[1].toLowerCase();
  if (!ALLOWED_EXT.has(ext)) {
    return res.status(400).json({ error: 'Only PDF, DOC, DOCX files are allowed' });
  }

  let buf;
  try { buf = Buffer.from(body.base64, 'base64'); }
  catch { return res.status(400).json({ error: 'Invalid base64' }); }

  if (buf.length === 0)           return res.status(400).json({ error: 'Empty file' });
  if (buf.length > MAX_BYTES)     return res.status(413).json({ error: 'File too large (max 4MB)' });

  // Validate by magic bytes — defeats spoofed extensions/MIME types.
  const detected = detectMime(buf);
  if (!detected || !ALLOWED_MIME.has(detected)) {
    return res.status(400).json({ error: 'File content does not look like a PDF, DOC, or DOCX' });
  }

  const stamp = Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 8);
  const objectPath = `${stamp}__${cleanName}`;

  try {
    await supabaseUpload(objectPath, buf, detected);
    const url = `${SUPABASE_URL.replace(/\/$/, '')}/storage/v1/object/public/${BUCKET}/${encodeURIComponent(objectPath)}`;
    return res.status(200).json({ success: true, url, path: objectPath });
  } catch (err) {
    console.error('Upload error:', err.message);
    return res.status(500).json({ error: 'Upload failed' }); // no internals leaked
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
        'apikey':         SUPABASE_KEY,
        'Authorization': `Bearer ${SUPABASE_KEY}`,
        'Content-Type':   contentType,
        'x-upsert':       'false',
        'Content-Length': buf.length,
      },
    }, r => {
      let raw = '';
      r.on('data', c => raw += c);
      r.on('end', () => {
        if (r.statusCode >= 200 && r.statusCode < 300) return resolve();
        reject(new Error(`Supabase storage ${r.statusCode}: ${raw.slice(0, 200)}`));
      });
    });
    req.on('error', reject);
    req.write(buf);
    req.end();
  });
}
