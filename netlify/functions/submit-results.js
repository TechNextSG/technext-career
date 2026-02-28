'use strict';
/**
 * MUST Assessment — Odoo Submission Function
 * Receives assessment results and writes them back to the hr.applicant record in Odoo.
 *
 * Required Netlify environment variables:
 *   ODOO_URL      — e.g. https://mycompany.odoo.com
 *   ODOO_DB       — Odoo database name
 *   ODOO_USER     — Odoo login (email)
 *   ODOO_API_KEY  — Odoo API key (Settings → Users → [user] → Action → API Keys)
 *
 * Optional: create these custom fields on hr.applicant in Odoo for full tracking:
 *   x_must_score_total  (Float)   x_must_score_m  (Float)   x_must_score_u  (Float)
 *   x_must_score_s      (Float)   x_must_score_t  (Float)   x_must_result   (Char)
 *   x_must_completed    (Boolean) x_must_consistency_flag  (Char)
 * If fields don't exist, scores still appear as a chatter note on the applicant.
 */

const https = require('https');
const http  = require('http');

const ODOO_URL     = process.env.ODOO_URL     || '';
const ODOO_DB      = process.env.ODOO_DB      || '';
const ODOO_USER    = process.env.ODOO_USER    || '';
const ODOO_API_KEY = process.env.ODOO_API_KEY || '';

// ─── XML-RPC helpers ────────────────────────────────────────────────────────

function escapeXml(s) {
  return String(s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;')
    .replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

function toXmlVal(v) {
  if (v === null || v === undefined) return '<value><nil/></value>';
  if (typeof v === 'boolean')  return `<value><boolean>${v ? 1 : 0}</boolean></value>`;
  if (Number.isInteger(v))     return `<value><int>${v}</int></value>`;
  if (typeof v === 'number')   return `<value><double>${v}</double></value>`;
  if (typeof v === 'string')   return `<value><string>${escapeXml(v)}</string></value>`;
  if (Array.isArray(v))        return `<value><array><data>${v.map(toXmlVal).join('')}</data></array></value>`;
  if (typeof v === 'object') {
    const m = Object.entries(v)
      .map(([k, val]) => `<member><name>${escapeXml(k)}</name>${toXmlVal(val)}</member>`)
      .join('');
    return `<value><struct>${m}</struct></value>`;
  }
  return `<value><string>${escapeXml(String(v))}</string></value>`;
}

function buildCall(method, params) {
  const p = params.map(v => `<param>${toXmlVal(v)}</param>`).join('');
  return `<?xml version="1.0"?><methodCall><methodName>${method}</methodName><params>${p}</params></methodCall>`;
}

function parseResponse(xml) {
  if (/<fault>/.test(xml)) {
    const m = xml.match(/<name>faultString<\/name>[\s\S]*?<string>([\s\S]*?)<\/string>/);
    throw new Error(`Odoo fault: ${m ? m[1].trim() : 'unknown'}`);
  }
  const i = xml.match(/<value><int>(\d+)<\/int>/);
  if (i) return parseInt(i[1]);
  const b = xml.match(/<value><boolean>([01])<\/boolean>/);
  if (b) return b[1] === '1';
  return true;
}

function xmlrpc(endpoint, body) {
  return new Promise((resolve, reject) => {
    const buf = Buffer.from(body, 'utf8');
    const u   = new URL(ODOO_URL);
    const lib = u.protocol === 'https:' ? https : http;
    const req = lib.request({
      hostname: u.hostname,
      port: u.port || (u.protocol === 'https:' ? 443 : 80),
      path: endpoint,
      method: 'POST',
      headers: {
        'Content-Type': 'text/xml; charset=utf-8',
        'Content-Length': buf.length
      }
    }, res => {
      let d = '';
      res.on('data', c => d += c);
      res.on('end', () => {
        try { resolve(parseResponse(d)); }
        catch (e) { reject(e); }
      });
    });
    req.on('error', reject);
    req.write(buf);
    req.end();
  });
}

function odoo(endpoint, method, params) {
  return xmlrpc(endpoint, buildCall(method, params));
}

// ─── Lambda handler ──────────────────────────────────────────────────────────

exports.handler = async function (event) {
  const CORS = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Access-Control-Allow-Methods': 'POST, OPTIONS'
  };

  if (event.httpMethod === 'OPTIONS') return { statusCode: 200, headers: CORS, body: '' };
  if (event.httpMethod !== 'POST')
    return { statusCode: 405, headers: CORS, body: JSON.stringify({ error: 'Method not allowed' }) };

  if (!ODOO_URL || !ODOO_DB || !ODOO_USER || !ODOO_API_KEY)
    return {
      statusCode: 503, headers: CORS,
      body: JSON.stringify({ error: 'Odoo not configured. Set ODOO_URL, ODOO_DB, ODOO_USER, ODOO_API_KEY in Netlify → Site settings → Environment variables.' })
    };

  let p;
  try { p = JSON.parse(event.body); }
  catch { return { statusCode: 400, headers: CORS, body: JSON.stringify({ error: 'Invalid JSON body' }) }; }

  const { applicantId, candidateName, position, experience, scores, result, consistency, completionTime } = p;
  if (!applicantId)
    return { statusCode: 400, headers: CORS, body: JSON.stringify({ error: 'applicantId is required' }) };

  try {
    // 1. Authenticate
    const uid = await odoo('/xmlrpc/2/common', 'authenticate', [ODOO_DB, ODOO_USER, ODOO_API_KEY, {}]);
    if (typeof uid !== 'number' || !uid)
      throw new Error('Odoo authentication failed — verify ODOO_USER and ODOO_API_KEY');

    // 2. Write custom score fields (graceful fail — fields are optional)
    try {
      await odoo('/xmlrpc/2/object', 'execute_kw', [
        ODOO_DB, uid, ODOO_API_KEY,
        'hr.applicant', 'write',
        [[parseInt(applicantId)], {
          x_must_score_total:      scores.overall || 0,
          x_must_score_m:          scores.M  || 0,
          x_must_score_u:          scores.U  || 0,
          x_must_score_s:          scores.S  || 0,
          x_must_score_t:          scores.T  || 0,
          x_must_result:           result || '',
          x_must_completed:        true,
          x_must_consistency_flag: consistency && consistency.flagged ? 'Flagged' : 'Clean'
        }],
        {}
      ]);
    } catch (fieldErr) {
      // Custom fields not yet created — scores will appear in chatter only
      console.warn('[MUST] Custom fields not created:', fieldErr.message);
    }

    // 3. Always post chatter note (works without custom fields)
    const flagHtml = consistency && consistency.flagged
      ? '<p style="color:#7d6608;background:#fef9e7;padding:8px 12px;border-radius:4px;margin-top:8px">⚠ <strong>Consistency flag:</strong> All 8 reverse-scored items answered in non-limiting direction. Verify authentic self-awareness in interview.</p>'
      : '';

    const noteBody = `
      <p><strong>📋 MUST Assessment Completed</strong></p>
      <table style="border-collapse:collapse;font-size:13px;margin:8px 0">
        <tr><td style="padding:4px 20px 4px 0"><strong>Result</strong></td><td><strong>${result}</strong></td></tr>
        <tr><td style="padding:4px 20px 4px 0">Overall score</td><td>${scores.overall}%</td></tr>
        <tr><td style="padding:4px 20px 4px 0">Mission (M)</td><td>${scores.M}%</td></tr>
        <tr><td style="padding:4px 20px 4px 0">Underdog (U)</td><td>${scores.U}%</td></tr>
        <tr><td style="padding:4px 20px 4px 0">Sacrifice (S)</td><td>${scores.S}%</td></tr>
        <tr><td style="padding:4px 20px 4px 0">Technical (T)</td><td>${scores.T}%</td></tr>
        <tr><td style="padding:4px 20px 4px 0">Candidate</td><td>${candidateName || '—'}</td></tr>
        <tr><td style="padding:4px 20px 4px 0">Position</td><td>${position || '—'}</td></tr>
        <tr><td style="padding:4px 20px 4px 0">Experience</td><td>${experience || '—'}</td></tr>
        <tr><td style="padding:4px 20px 4px 0">Completion time</td><td>${completionTime || '—'}</td></tr>
      </table>${flagHtml}
    `.trim();

    await odoo('/xmlrpc/2/object', 'execute_kw', [
      ODOO_DB, uid, ODOO_API_KEY,
      'mail.message', 'create',
      [{
        model:         'hr.applicant',
        res_id:        parseInt(applicantId),
        body:          noteBody,
        message_type:  'comment',
        subtype_xmlid: 'mail.mt_note'
      }],
      {}
    ]);

    return { statusCode: 200, headers: CORS, body: JSON.stringify({ success: true }) };

  } catch (err) {
    console.error('[MUST] Odoo error:', err.message);
    return { statusCode: 500, headers: CORS, body: JSON.stringify({ error: err.message }) };
  }
};
