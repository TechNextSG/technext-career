'use strict';
/**
 * TechNext → Odoo bridge.
 *
 *   odooSync(payload, supabaseId)
 *     - Upserts an `hr.applicant` by email (=ilike).
 *     - Writes `x_tn_*` custom fields IF the optional `tn_assessment` Odoo
 *       module is installed (we pre-fetch the field list once per warm
 *       container and intersect — no faults if the module isn't there).
 *     - Always posts a clean chatter note as the universal fallback.
 *     - On the first sync for that applicant, fetches the candidate's
 *       Supabase-hosted resume and attaches it as ir.attachment. Capped
 *       at 10 MB with a 2 s fetch timeout; falls back to chatter link
 *       on any failure.
 *
 *   pingOdoo()
 *     - Auths and returns { uid, has_custom_fields } for the smoke
 *       endpoint at /api/odoo-ping.
 *
 * Env (set in Vercel → Project Settings → Environment Variables):
 *   ODOO_URL                              required (https://<co>.odoo.com)
 *   ODOO_DB                               required
 *   ODOO_USER                             required (Odoo login email)
 *   ODOO_API_KEY                          required (Account Security → API Keys)
 *   ODOO_SYNC_ENABLED                     'false' kills the sync entirely
 *   ODOO_SYNC_TIMEOUT_MS                  default 3500 — hard timeout on the
 *                                         entire sync from the submit handler
 *   ODOO_JOB_AI_ENGINEER_ID               optional; unset → no job_id
 *   ODOO_JOB_FUNCTIONAL_CONSULTANT_ID     optional
 *   ODOO_JOB_ODOO_DEVELOPER_ID            optional
 *   ODOO_JOB_CYBER_SECURITY_ID            optional
 *
 * No npm deps — Node `https` + hand-rolled XML-RPC.
 */

const https = require('https');
const http  = require('http');

const ODOO_URL     = (process.env.ODOO_URL     || '').replace(/\/$/, '');
const ODOO_DB     =  process.env.ODOO_DB      || '';
const ODOO_USER   =  process.env.ODOO_USER    || '';
const ODOO_API_KEY = process.env.ODOO_API_KEY || '';

const SYNC_ENABLED = (process.env.ODOO_SYNC_ENABLED || 'true').toLowerCase() !== 'false';
const SYNC_TIMEOUT = parseInt(process.env.ODOO_SYNC_TIMEOUT_MS || '3500', 10);

const JOB_ID_BY_ROLE = {
  'ai-engineer':            parseEnvInt('ODOO_JOB_AI_ENGINEER_ID'),
  'functional-consultant':  parseEnvInt('ODOO_JOB_FUNCTIONAL_CONSULTANT_ID'),
  'odoo-developer':         parseEnvInt('ODOO_JOB_ODOO_DEVELOPER_ID'),
  'cyber-security':         parseEnvInt('ODOO_JOB_CYBER_SECURITY_ID'),
};

const ROLE_LABEL = {
  'ai-engineer':           'AI Engineer',
  'functional-consultant': 'Functional Consultant / Business Analyst',
  'odoo-developer':        'Odoo Developer',
  'cyber-security':        'Cyber Security',
};

const TEST_LABEL = {
  'tn_company_quiz':    'About TechNext',
  'tn_profiler':        'TechNext Profiler (DISC + Type)',
  'tn_iq':              'Reasoning Test',
  'tn_ai_technical':    'AI Engineer — Technical',
  'tn_fc_technical':    'FC / BA — Technical',
  'tn_odoo_technical':  'Odoo Developer — Technical',
  'tn_cyber_technical': 'Cyber Security — Technical',
  'tn_booking':         'Interview Booking',
};

function parseEnvInt(name) {
  const v = parseInt(process.env[name] || '', 10);
  return Number.isFinite(v) && v > 0 ? v : null;
}

function isConfigured() {
  return !!(ODOO_URL && ODOO_DB && ODOO_USER && ODOO_API_KEY);
}

/* ── Cached state (per warm Lambda container) ──────────────────────────── */

let cachedUid = null;
let cachedXTnFields = null;    // Set<string> of `x_tn_*` field names present
let cachedNoteSubtypeId = null;
let unmappedJobLogged = {};

/* ── Structured logging (no PII leak) ──────────────────────────────────── */

function emailHash(s) {
  try {
    // Lightweight, deterministic, non-cryptographic.
    let h = 5381;
    for (let i = 0; i < s.length; i++) h = ((h << 5) + h + s.charCodeAt(i)) | 0;
    return (h >>> 0).toString(36);
  } catch (e) { return '?'; }
}

function logEvt(evt, extra) {
  try {
    const line = Object.assign({ evt, t: new Date().toISOString() }, extra || {});
    console.log(JSON.stringify(line));
  } catch (e) { /* never let logging break the call */ }
}

/* ── XML-RPC helpers (hand-rolled, no npm deps) ────────────────────────── */

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

function parseXmlValue(node) {
  // node is a substring containing exactly one <value>...</value> contents (without the <value> tags).
  // This is a *minimal* XML-RPC parser tailored to Odoo's return shapes:
  //   <int>, <i4>, <double>, <boolean>, <string>, <nil/>, <array>, <struct>.
  const trim = node.trim();
  if (/^<nil\s*\/?>/.test(trim)) return null;
  let m;
  if ((m = trim.match(/^<(int|i4)>(-?\d+)<\/(int|i4)>/)))     return parseInt(m[2], 10);
  if ((m = trim.match(/^<double>(-?\d+(?:\.\d+)?)<\/double>/))) return parseFloat(m[1]);
  if ((m = trim.match(/^<boolean>([01])<\/boolean>/)))        return m[1] === '1';
  if ((m = trim.match(/^<string>([\s\S]*?)<\/string>/)))      return unescapeXml(m[1]);
  if (/^<array>/.test(trim))  return parseArray(trim);
  if (/^<struct>/.test(trim)) return parseStruct(trim);
  // No tag — XML-RPC permits a bare string inside <value>.
  return unescapeXml(trim);
}

function unescapeXml(s) {
  return String(s)
    .replace(/&lt;/g, '<').replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"').replace(/&apos;/g, "'")
    .replace(/&amp;/g, '&');
}

function findMatching(src, openTag, closeTag, startIdx) {
  // Returns the END index of the matching close tag for a balanced pair, given that
  // `startIdx` is the position right after the first opening tag.
  let depth = 1;
  let i = startIdx;
  const openRe = new RegExp('<' + openTag + '(?:\\s|>)', 'g');
  const closeRe = new RegExp('</' + closeTag + '>', 'g');
  while (depth > 0 && i < src.length) {
    openRe.lastIndex = i;
    closeRe.lastIndex = i;
    const openMatch = openRe.exec(src);
    const closeMatch = closeRe.exec(src);
    if (!closeMatch) return -1;
    if (openMatch && openMatch.index < closeMatch.index) {
      depth++;
      i = openMatch.index + openMatch[0].length;
    } else {
      depth--;
      i = closeMatch.index + closeMatch[0].length;
      if (depth === 0) return i;
    }
  }
  return -1;
}

function parseArray(src) {
  // src starts with <array><data>...</data></array>
  const dataStart = src.indexOf('<data>');
  if (dataStart < 0) return [];
  let i = dataStart + '<data>'.length;
  const out = [];
  while (i < src.length) {
    const next = src.indexOf('<value>', i);
    const end = src.indexOf('</data>', i);
    if (next < 0 || next > end) break;
    const valStart = next + '<value>'.length;
    const valEnd = findMatching(src, 'value', 'value', valStart);
    if (valEnd < 0) break;
    const inner = src.slice(valStart, valEnd - '</value>'.length);
    out.push(parseXmlValue(inner));
    i = valEnd;
  }
  return out;
}

function parseStruct(src) {
  // src starts with <struct>...</struct>
  const out = {};
  const memberRe = /<member>\s*<name>([\s\S]*?)<\/name>\s*<value>/g;
  let m;
  while ((m = memberRe.exec(src)) !== null) {
    const name = unescapeXml(m[1]);
    const valStart = m.index + m[0].length;
    const valEnd = findMatching(src, 'value', 'value', valStart);
    if (valEnd < 0) break;
    const inner = src.slice(valStart, valEnd - '</value>'.length);
    out[name] = parseXmlValue(inner);
    memberRe.lastIndex = valEnd;
  }
  return out;
}

function parseResponse(xml) {
  if (/<fault>/.test(xml)) {
    const m = xml.match(/<name>faultString<\/name>[\s\S]*?<string>([\s\S]*?)<\/string>/);
    const fault = new Error('Odoo fault: ' + (m ? unescapeXml(m[1]).trim() : 'unknown'));
    fault.isOdooFault = true;
    throw fault;
  }
  // Top-level: <methodResponse><params><param><value>...</value></param></params></methodResponse>
  const start = xml.indexOf('<param>');
  if (start < 0) return null;
  const valStart = xml.indexOf('<value>', start);
  if (valStart < 0) return null;
  const valEnd = findMatching(xml, 'value', 'value', valStart + '<value>'.length);
  if (valEnd < 0) return null;
  const inner = xml.slice(valStart + '<value>'.length, valEnd - '</value>'.length);
  return parseXmlValue(inner);
}

function xmlrpc(endpoint, body, timeoutMs) {
  return new Promise((resolve, reject) => {
    if (!ODOO_URL) return reject(new Error('ODOO_URL not configured'));
    let u;
    try { u = new URL(ODOO_URL); } catch (e) { return reject(new Error('ODOO_URL malformed: ' + ODOO_URL)); }
    const lib = u.protocol === 'https:' ? https : http;
    const buf = Buffer.from(body, 'utf8');
    const req = lib.request({
      hostname: u.hostname,
      port: u.port || (u.protocol === 'https:' ? 443 : 80),
      path: endpoint,
      method: 'POST',
      headers: {
        'Content-Type':   'text/xml; charset=utf-8',
        'Content-Length': buf.length,
      },
    }, res => {
      let d = '';
      res.on('data', c => d += c);
      res.on('end', () => {
        try { resolve(parseResponse(d)); }
        catch (e) { reject(e); }
      });
    });
    if (timeoutMs && timeoutMs > 0) {
      req.setTimeout(timeoutMs, () => { req.destroy(new Error('XML-RPC timeout')); });
    }
    req.on('error', reject);
    req.write(buf);
    req.end();
  });
}

function call(endpoint, method, params, timeoutMs) {
  return xmlrpc(endpoint, buildCall(method, params), timeoutMs);
}

/* ── Auth (cached) ─────────────────────────────────────────────────────── */

async function authenticate(force) {
  if (cachedUid && !force) return cachedUid;
  const uid = await call('/xmlrpc/2/common', 'authenticate', [ODOO_DB, ODOO_USER, ODOO_API_KEY, {}], 5000);
  if (typeof uid !== 'number' || !uid) {
    throw new Error('Odoo authentication failed — check ODOO_USER and ODOO_API_KEY');
  }
  cachedUid = uid;
  return uid;
}

async function execute_kw(model, method, args, kwargs, timeoutMs) {
  const uid = await authenticate();
  try {
    return await call('/xmlrpc/2/object', 'execute_kw',
      [ODOO_DB, uid, ODOO_API_KEY, model, method, args || [], kwargs || {}], timeoutMs);
  } catch (e) {
    // Session looks bad — re-auth once and retry.
    if (e && e.isOdooFault && /AccessDenied|Session|Invalid uid/i.test(e.message)) {
      cachedUid = null;
      const uid2 = await authenticate(true);
      return await call('/xmlrpc/2/object', 'execute_kw',
        [ODOO_DB, uid2, ODOO_API_KEY, model, method, args || [], kwargs || {}], timeoutMs);
    }
    throw e;
  }
}

/* ── Custom-field discovery (cached) ───────────────────────────────────── */

async function loadXTnFields() {
  if (cachedXTnFields) return cachedXTnFields;
  try {
    const rows = await execute_kw(
      'ir.model.fields',
      'search_read',
      [[['model', '=', 'hr.applicant'], ['name', '=like', 'x_tn_%']]],
      { fields: ['name'] },
      5000
    );
    cachedXTnFields = new Set((rows || []).map(r => r.name));
  } catch (e) {
    logEvt('odoo_field_introspect_fail', { err: shortErr(e) });
    cachedXTnFields = new Set(); // act as if no fields
  }
  return cachedXTnFields;
}

async function loadNoteSubtypeId() {
  if (cachedNoteSubtypeId !== null) return cachedNoteSubtypeId;
  try {
    const rows = await execute_kw(
      'ir.model.data',
      'search_read',
      [[['module', '=', 'mail'], ['name', '=', 'mt_note']]],
      { fields: ['res_id'], limit: 1 },
      5000
    );
    cachedNoteSubtypeId = rows && rows[0] ? rows[0].res_id : 0;
  } catch (e) {
    cachedNoteSubtypeId = 0;
  }
  return cachedNoteSubtypeId;
}

/* ── Test-type → custom-field mapping ──────────────────────────────────── */

function buildCustomFields(payload, fieldSet) {
  // Start with the always-on identity fields, then mix in test-specific scores.
  const out = {
    x_tn_role:         payload.candidate_role || '',
    x_tn_linkedin:     payload.candidate_linkedin || '',
    x_tn_resume_url:   payload.candidate_resume_url || '',
    x_tn_last_synced:  toOdooDatetime(new Date()),
  };

  const t = payload.test_type;
  const sec = payload.section_scores || {};
  const flags = payload.flags || {};
  const pct = payload.score_pct;

  switch (t) {
    case 'tn_company_quiz':
      if (payload.score_raw != null && payload.score_max) {
        out.x_tn_company_quiz_pct = Math.round((payload.score_raw / payload.score_max) * 100);
      }
      break;
    case 'tn_profiler':
      if (sec.D != null) out.x_tn_profiler_d_pct = num(sec.D);
      if (sec.I != null) out.x_tn_profiler_i_pct = num(sec.I);
      if (sec.S != null) out.x_tn_profiler_s_pct = num(sec.S);
      if (sec.C != null) out.x_tn_profiler_c_pct = num(sec.C);
      if (flags.primary)   out.x_tn_profiler_disc_primary   = String(flags.primary);
      if (flags.secondary) out.x_tn_profiler_disc_secondary = String(flags.secondary);
      if (flags.type || sec.MBTI) out.x_tn_profiler_mbti = String(flags.type || sec.MBTI);
      break;
    case 'tn_iq':              if (pct != null) out.x_tn_reasoning_pct      = num(pct); break;
    case 'tn_ai_technical':    if (pct != null) out.x_tn_ai_technical_pct   = num(pct); break;
    case 'tn_fc_technical':    if (pct != null) out.x_tn_fc_technical_pct   = num(pct); break;
    case 'tn_odoo_technical':  if (pct != null) out.x_tn_odoo_technical_pct = num(pct); break;
    case 'tn_cyber_technical': if (pct != null) out.x_tn_cyber_technical_pct = num(pct); break;
    case 'tn_booking':
      if (payload.start_time) out.x_tn_booking_slot = toOdooDatetime(new Date(payload.start_time));
      break;
  }

  // Intersect with the live custom-field list — drop anything the Odoo
  // companion module hasn't exposed. (If the module isn't installed at all,
  // this leaves us with an empty object and we skip the write entirely.)
  const filtered = {};
  for (const k of Object.keys(out)) {
    if (fieldSet.has(k)) filtered[k] = out[k];
  }
  return filtered;
}

function num(x) { const n = Number(x); return Number.isFinite(n) ? n : 0; }

function toOdooDatetime(d) {
  // Odoo datetime fields want 'YYYY-MM-DD HH:MM:SS' in UTC, no timezone suffix.
  const pad = n => (n < 10 ? '0' : '') + n;
  return d.getUTCFullYear() + '-' + pad(d.getUTCMonth() + 1) + '-' + pad(d.getUTCDate()) +
         ' ' + pad(d.getUTCHours()) + ':' + pad(d.getUTCMinutes()) + ':' + pad(d.getUTCSeconds());
}

/* ── Chatter note body ─────────────────────────────────────────────────── */

function shortErr(e) {
  const m = (e && e.message) || String(e);
  return m.length > 2000 ? m.slice(0, 2000) + '…' : m;
}

function fmt(v) { return v == null || v === '' ? '—' : String(v); }
function escHtml(s) { return escapeXml(s == null ? '' : String(s)); }

function buildChatterHtml(payload, supabaseId) {
  const t = payload.test_type;
  const testLabel = TEST_LABEL[t] || t;
  const roleLabel = ROLE_LABEL[payload.candidate_role] || payload.candidate_role || '—';
  const ts = new Date().toLocaleString('en-GB', { dateStyle: 'medium', timeStyle: 'short', timeZone: 'UTC' }) + ' UTC';

  let body = '';

  if (t === 'tn_profiler') {
    const s = payload.section_scores || {};
    const flags = payload.flags || {};
    body =
      '<p><b>TechNext — ' + escHtml(testLabel) + '</b> · ' + escHtml(ts) + '</p>' +
      '<table style="border-collapse:collapse;font-size:13px;margin:6px 0">' +
        '<tr><td style="padding:3px 16px 3px 0"><b>DISC</b></td>' +
            '<td style="padding:3px 16px 3px 0">D ' + fmt(s.D) + '%</td>' +
            '<td style="padding:3px 16px 3px 0">I ' + fmt(s.I) + '%</td>' +
            '<td style="padding:3px 16px 3px 0">S ' + fmt(s.S) + '%</td>' +
            '<td style="padding:3px 0">C ' + fmt(s.C) + '%</td></tr>' +
        '<tr><td style="padding:3px 16px 3px 0"><b>Primary</b></td>' +
            '<td colspan="4">' + escHtml(fmt(flags.primary)) + (flags.secondary ? ' / ' + escHtml(flags.secondary) : '') + '</td></tr>' +
        '<tr><td style="padding:3px 16px 3px 0"><b>4-letter Type</b></td>' +
            '<td colspan="4">' + escHtml(fmt(flags.type || s.MBTI)) + '</td></tr>' +
      '</table>';
  } else if (t === 'tn_booking') {
    const ans = payload.answers || {};
    body =
      '<p><b>TechNext — ' + escHtml(testLabel) + '</b> · ' + escHtml(ts) + '</p>' +
      '<table style="border-collapse:collapse;font-size:13px;margin:6px 0">' +
        '<tr><td style="padding:3px 16px 3px 0">Slot</td><td>' + escHtml(fmt(payload.start_time)) + '</td></tr>' +
        '<tr><td style="padding:3px 16px 3px 0">Duration</td><td>45 min</td></tr>' +
        '<tr><td style="padding:3px 16px 3px 0">Interviewer</td><td>' + escHtml(fmt(ans.interviewer)) + '</td></tr>' +
      '</table>' +
      '<p style="background:#fffbeb;border-left:3px solid #f59e0b;padding:6px 10px;margin:6px 0;font-size:12.5px"><b>Note:</b> expression of interest only. The interviewer will confirm a final slot by email or handphone.</p>';
  } else {
    // Default scored format
    const scoreLine = payload.score_pct != null
      ? 'Score: ' + payload.score_raw + ' / ' + payload.score_max + ' (' + payload.score_pct + '%)'
      : 'Submitted';
    body =
      '<p><b>TechNext — ' + escHtml(testLabel) + '</b> · ' + escHtml(ts) + '</p>' +
      '<table style="border-collapse:collapse;font-size:13px;margin:6px 0">' +
        '<tr><td style="padding:3px 16px 3px 0"><b>Result</b></td><td>' + escHtml(fmt(payload.result_label)) + '</td></tr>' +
        '<tr><td style="padding:3px 16px 3px 0"><b>Score</b></td><td>' + escHtml(scoreLine) + '</td></tr>' +
      '</table>';
  }

  // Universal footer
  body +=
    '<table style="border-collapse:collapse;font-size:12.5px;color:#475569;margin-top:8px">' +
      '<tr><td style="padding:2px 14px 2px 0">Role applied</td><td>' + escHtml(roleLabel) + '</td></tr>' +
      (payload.candidate_linkedin
        ? '<tr><td style="padding:2px 14px 2px 0">LinkedIn</td><td><a href="' + escHtml(payload.candidate_linkedin) + '" target="_blank" rel="noopener">' + escHtml(payload.candidate_linkedin) + '</a></td></tr>'
        : '') +
      (payload.candidate_resume_url
        ? '<tr><td style="padding:2px 14px 2px 0">Resume</td><td><a href="' + escHtml(payload.candidate_resume_url) + '" target="_blank" rel="noopener">Download / view</a></td></tr>'
        : '') +
      (payload.candidate_phone
        ? '<tr><td style="padding:2px 14px 2px 0">Handphone</td><td>' + escHtml(payload.candidate_phone) + '</td></tr>'
        : '') +
      (supabaseId
        ? '<tr><td style="padding:2px 14px 2px 0">Supabase ID</td><td><code>' + escHtml(supabaseId) + '</code></td></tr>'
        : '') +
    '</table>';

  return body;
}

/* ── Upsert + sync orchestrator ────────────────────────────────────────── */

async function findApplicant(email) {
  const rows = await execute_kw(
    'hr.applicant',
    'search_read',
    [[['email_from', '=ilike', email]]],
    { fields: ['id', 'partner_name', 'attachment_ids'], limit: 1 },
    5000
  );
  return (rows && rows[0]) || null;
}

async function createApplicant(payload) {
  const role = payload.candidate_role || '';
  const roleLabel = ROLE_LABEL[role] || role || 'TechNext';
  const displayName = payload.candidate_name || payload.candidate_email || 'Anonymous';
  const vals = {
    partner_name: displayName,
    email_from: payload.candidate_email,
    partner_phone: payload.candidate_phone || false,
  };
  const jobId = JOB_ID_BY_ROLE[role];
  if (jobId) {
    vals.job_id = jobId;
  } else if (role && !unmappedJobLogged[role]) {
    unmappedJobLogged[role] = true;
    logEvt('odoo_job_unmapped', { role: role });
  }
  return await execute_kw('hr.applicant', 'create', [vals], {}, 5000);
}

async function postChatter(applicantId, htmlBody) {
  const subtypeId = await loadNoteSubtypeId();
  const vals = {
    model:        'hr.applicant',
    res_id:       applicantId,
    body:         htmlBody,
    message_type: 'comment',
  };
  if (subtypeId) vals.subtype_id = subtypeId;
  await execute_kw('mail.message', 'create', [vals], {}, 5000);
}

function guessMimeType(url) {
  const lower = (url || '').toLowerCase();
  if (lower.endsWith('.pdf')) return 'application/pdf';
  if (lower.endsWith('.doc')) return 'application/msword';
  if (lower.endsWith('.docx')) return 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';
  return 'application/octet-stream';
}

function fetchBinary(url, timeoutMs, maxBytes) {
  return new Promise((resolve, reject) => {
    let parsed;
    try { parsed = new URL(url); } catch (e) { return reject(new Error('bad url')); }
    const lib = parsed.protocol === 'https:' ? https : http;
    const req = lib.get(parsed, res => {
      // Follow a single redirect — Supabase Storage occasionally serves 30x.
      if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
        res.resume();
        fetchBinary(res.headers.location, timeoutMs, maxBytes).then(resolve, reject);
        return;
      }
      if (res.statusCode !== 200) {
        res.resume();
        return reject(new Error('HTTP ' + res.statusCode));
      }
      const chunks = [];
      let n = 0;
      res.on('data', c => {
        n += c.length;
        if (n > maxBytes) { req.destroy(new Error('exceeds max ' + maxBytes)); return; }
        chunks.push(c);
      });
      res.on('end', () => resolve(Buffer.concat(chunks)));
      res.on('error', reject);
    });
    if (timeoutMs && timeoutMs > 0) {
      req.setTimeout(timeoutMs, () => req.destroy(new Error('fetch timeout')));
    }
    req.on('error', reject);
  });
}

async function attachResumeIfNeeded(applicant, payload) {
  if (!payload.candidate_resume_url) return false;
  if (applicant.attachment_ids && applicant.attachment_ids.length > 0) return false; // already has attachments
  try {
    const buf = await fetchBinary(payload.candidate_resume_url, 2000, 10 * 1024 * 1024);
    const filename = (payload.candidate_name || payload.candidate_email || 'candidate')
      .replace(/[^a-zA-Z0-9._-]+/g, '_').slice(0, 80) + '_CV.' + (payload.candidate_resume_url.split('.').pop() || 'pdf');
    await execute_kw('ir.attachment', 'create', [{
      name:       filename,
      type:       'binary',
      datas:      buf.toString('base64'),
      mimetype:   guessMimeType(payload.candidate_resume_url),
      res_model:  'hr.applicant',
      res_id:     applicant.id,
    }], {}, 6000);
    return true;
  } catch (e) {
    logEvt('odoo_resume_attach_fail', { applicant_id: applicant.id, err: shortErr(e) });
    return false;
  }
}

/**
 * Main entry point. Idempotent on Supabase-level retries (we always upsert).
 */
async function odooSync(payload, supabaseId) {
  if (!SYNC_ENABLED) return { skipped: 'disabled' };
  if (!isConfigured()) return { skipped: 'not_configured' };
  if (!payload || !payload.candidate_email) return { skipped: 'no_email' };

  const email = String(payload.candidate_email).trim().toLowerCase();
  let applicant = null;
  let created = false;

  // 1. Upsert
  applicant = await findApplicant(email);
  if (!applicant) {
    const id = await createApplicant(payload);
    applicant = { id: id, name: payload.candidate_name || email, attachment_ids: [] };
    created = true;
  }

  // 2. Write custom fields if present
  const fieldSet = await loadXTnFields();
  if (fieldSet.size > 0) {
    const fields = buildCustomFields(payload, fieldSet);
    if (Object.keys(fields).length > 0) {
      try {
        await execute_kw('hr.applicant', 'write', [[applicant.id], fields], {}, 5000);
      } catch (e) {
        // If write fails for any field (e.g. type mismatch), drop everything except
        // last-synced and retry once.
        logEvt('odoo_field_write_fail_retrying', { applicant_id: applicant.id, err: shortErr(e) });
        try {
          await execute_kw('hr.applicant', 'write', [[applicant.id], { x_tn_last_synced: toOdooDatetime(new Date()) }], {}, 5000);
        } catch (e2) { /* swallow — chatter still goes out */ }
      }
    }
  }

  // 3. Chatter note (always)
  try {
    await postChatter(applicant.id, buildChatterHtml(payload, supabaseId));
  } catch (e) {
    logEvt('odoo_chatter_fail', { applicant_id: applicant.id, err: shortErr(e) });
  }

  // 4. Resume attach (first sync only)
  if (created || !applicant.attachment_ids || applicant.attachment_ids.length === 0) {
    await attachResumeIfNeeded(applicant, payload);
  }

  logEvt('odoo_sync_ok', {
    applicant_id: applicant.id,
    created: created,
    test_type: payload.test_type,
    email_hash: emailHash(email),
    supabase_id: supabaseId || null,
  });

  return { applicant_id: applicant.id, created: created };
}

async function pingOdoo() {
  if (!isConfigured()) {
    return { ok: false, error: 'Odoo not configured. Set ODOO_URL, ODOO_DB, ODOO_USER, ODOO_API_KEY in Vercel env vars.' };
  }
  const uid = await authenticate(true); // force fresh auth
  const fieldSet = await loadXTnFields();
  return {
    ok: true,
    uid: uid,
    url: ODOO_URL,
    db: ODOO_DB,
    has_custom_fields: fieldSet.size > 0,
    custom_field_count: fieldSet.size,
    sync_enabled: SYNC_ENABLED,
  };
}

/* ── Public surface ────────────────────────────────────────────────────── */

module.exports = {
  isConfigured,
  odooSync,
  pingOdoo,
  // Exposed for unit-style testing if you ever want to:
  _internal: {
    buildCustomFields,
    buildChatterHtml,
    toOdooDatetime,
    parseXmlValue,
    parseResponse,
  },
};
