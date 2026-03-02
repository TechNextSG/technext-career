/**
 * MUST Assessment — Netlify Deploy Script
 * Usage: node deploy.js YOUR_NETLIFY_TOKEN
 * Deploys must_assessment.html + the Odoo serverless function.
 */
const https  = require('https');
const fs     = require('fs');
const path   = require('path');
const crypto = require('crypto');

const TOKEN     = process.argv[2];
const SITE_NAME = 'must-engineering-assessment';
const HTML_V1   = path.join(__dirname, 'must_assessment.html');
const HTML_V2   = path.join(__dirname, 'must_jobs.html');
const TOML_PATH = path.join(__dirname, 'netlify.toml');
const FN_PATH   = path.join(__dirname, 'netlify', 'functions', 'submit-results.js');

if (!TOKEN) {
  console.error('\n❌  Usage: node deploy.js YOUR_NETLIFY_TOKEN\n');
  console.error('   Get a token at: https://app.netlify.com/user/applications → New access token\n');
  process.exit(1);
}

// ─── ZIP builder (pure Node — no external deps) ───────────────────────────────
function crc32(buf) {
  const tbl = new Uint32Array(256);
  for (let i = 0; i < 256; i++) {
    let c = i;
    for (let j = 0; j < 8; j++) c = (c & 1) ? 0xEDB88320 ^ (c >>> 1) : c >>> 1;
    tbl[i] = c;
  }
  let crc = 0xFFFFFFFF;
  for (let i = 0; i < buf.length; i++) crc = tbl[(crc ^ buf[i]) & 0xFF] ^ (crc >>> 8);
  return (crc ^ 0xFFFFFFFF) >>> 0;
}

function makeZip(filename, content) {
  const fn  = Buffer.from(filename, 'utf8');
  const fc  = Buffer.isBuffer(content) ? content : Buffer.from(content, 'utf8');
  const crc = crc32(fc);
  const sz  = fc.length;

  // Local file header
  const lfh = Buffer.alloc(30 + fn.length);
  lfh.writeUInt32LE(0x04034B50, 0);  // PK signature
  lfh.writeUInt16LE(20, 4);           // version needed
  lfh.writeUInt16LE(0, 6);            // flags
  lfh.writeUInt16LE(0, 8);            // no compression (store)
  lfh.writeUInt16LE(0, 10);           // mod time
  lfh.writeUInt16LE(0, 12);           // mod date
  lfh.writeUInt32LE(crc, 14);
  lfh.writeUInt32LE(sz, 18);
  lfh.writeUInt32LE(sz, 22);
  lfh.writeUInt16LE(fn.length, 26);
  lfh.writeUInt16LE(0, 28);           // extra field length
  fn.copy(lfh, 30);

  // Central directory header
  const cdh = Buffer.alloc(46 + fn.length);
  cdh.writeUInt32LE(0x02014B50, 0);
  cdh.writeUInt16LE(20, 4);
  cdh.writeUInt16LE(20, 6);
  cdh.writeUInt16LE(0, 8);
  cdh.writeUInt16LE(0, 10);
  cdh.writeUInt16LE(0, 12);
  cdh.writeUInt16LE(0, 14);
  cdh.writeUInt32LE(crc, 16);
  cdh.writeUInt32LE(sz, 20);
  cdh.writeUInt32LE(sz, 24);
  cdh.writeUInt16LE(fn.length, 28);
  cdh.writeUInt16LE(0, 30);
  cdh.writeUInt16LE(0, 32);
  cdh.writeUInt16LE(0, 34);
  cdh.writeUInt16LE(0, 36);
  cdh.writeUInt32LE(0, 38);
  cdh.writeUInt32LE(0, 42);           // offset of local header
  fn.copy(cdh, 46);

  // End of central directory
  const eocd = Buffer.alloc(22);
  eocd.writeUInt32LE(0x06054B50, 0);
  eocd.writeUInt16LE(0, 4);
  eocd.writeUInt16LE(0, 6);
  eocd.writeUInt16LE(1, 8);
  eocd.writeUInt16LE(1, 10);
  eocd.writeUInt32LE(cdh.length, 12);
  eocd.writeUInt32LE(lfh.length + sz, 16);
  eocd.writeUInt16LE(0, 20);

  return Buffer.concat([lfh, fc, cdh, eocd]);
}

// ─── Netlify API helper ────────────────────────────────────────────────────────
function apiRequest(method, endpoint, body, headers = {}) {
  return new Promise((resolve, reject) => {
    const isJSON = typeof body === 'string';
    const data   = isJSON ? Buffer.from(body, 'utf8') : body;

    const req = https.request({
      hostname: 'api.netlify.com',
      path: '/api/v1' + endpoint,
      method,
      headers: {
        'Authorization': `Bearer ${TOKEN}`,
        'Content-Type': isJSON ? 'application/json' : 'application/octet-stream',
        'Content-Length': data ? data.length : 0,
        ...headers
      }
    }, (res) => {
      let raw = '';
      res.on('data', c => raw += c);
      res.on('end', () => {
        try { resolve({ status: res.statusCode, body: JSON.parse(raw) }); }
        catch { resolve({ status: res.statusCode, body: raw }); }
      });
    });
    req.on('error', reject);
    if (data) req.write(data);
    req.end();
  });
}

// ─── Main deploy ──────────────────────────────────────────────────────────────
async function deploy() {
  const htmlV1    = fs.readFileSync(HTML_V1);
  const htmlV1Sha = crypto.createHash('sha1').update(htmlV1).digest('hex');

  const htmlV2    = fs.readFileSync(HTML_V2);
  const htmlV2Sha = crypto.createHash('sha1').update(htmlV2).digest('hex');

  const toml      = fs.readFileSync(TOML_PATH);
  const tomlSha   = crypto.createHash('sha1').update(toml).digest('hex');

  const fnSrc   = fs.readFileSync(FN_PATH);
  const fnZip   = makeZip('submit-results.js', fnSrc);
  const fnSha   = crypto.createHash('sha1').update(fnZip).digest('hex');

  console.log('\n🚀  MUST Jobs — Deploying to Netlify...\n');

  // 1. Look up or create site
  console.log('   [1/5] Looking up site...');
  const listRes  = await apiRequest('GET', '/sites?filter=owner');
  const existing = Array.isArray(listRes.body) && listRes.body.find(s => s.name === SITE_NAME);

  let siteId;
  if (existing) {
    siteId = existing.id;
    console.log(`   ✓ Existing site: ${existing.ssl_url || existing.url}`);
  } else {
    console.log('   [2/5] Creating new site...');
    const createRes = await apiRequest('POST', '/sites', JSON.stringify({ name: SITE_NAME }));
    if (createRes.status !== 201 && createRes.status !== 200) {
      const suffix      = Math.floor(Math.random() * 9000) + 1000;
      const fallback    = `must-assessment-${suffix}`;
      console.log(`   ↪  Name taken, trying: ${fallback}`);
      const retry       = await apiRequest('POST', '/sites', JSON.stringify({ name: fallback }));
      if (retry.status !== 201 && retry.status !== 200) throw new Error('Could not create site: ' + JSON.stringify(retry.body));
      siteId = retry.body.id;
      console.log(`   ✓ Site created: https://${fallback}.netlify.app`);
    } else {
      siteId = createRes.body.id;
      console.log(`   ✓ Site created: https://${SITE_NAME}.netlify.app`);
    }
  }

  // 2. Create deploy (files + function)
  console.log('   [3/5] Creating deploy...');
  const deployRes = await apiRequest('POST', `/sites/${siteId}/deploys`, JSON.stringify({
    files: {
      '/index.html':           htmlV2Sha,
      '/must_jobs.html':       htmlV2Sha,
      '/must_assessment.html': htmlV1Sha,
      '/netlify.toml':         tomlSha
    },
    functions: {
      'submit-results': fnSha
    },
    async: false
  }));

  if (!deployRes.body.id) throw new Error('Deploy creation failed: ' + JSON.stringify(deployRes.body));
  const deployId        = deployRes.body.id;
  const required        = deployRes.body.required        || [];
  const requiredFns     = deployRes.body.required_functions || [];

  // 3. Upload files if needed
  if (required.length > 0) {
    console.log('   [4/5] Uploading files...');
    if (required.includes(htmlV2Sha)) {
      await apiRequest('PUT', `/deploys/${deployId}/files/index.html`,      htmlV2, { 'Content-Type': 'text/html' });
      await apiRequest('PUT', `/deploys/${deployId}/files/must_jobs.html`,  htmlV2, { 'Content-Type': 'text/html' });
    }
    if (required.includes(htmlV1Sha)) {
      await apiRequest('PUT', `/deploys/${deployId}/files/must_assessment.html`, htmlV1, { 'Content-Type': 'text/html' });
    }
    if (required.includes(tomlSha)) {
      await apiRequest('PUT', `/deploys/${deployId}/files/netlify.toml`, toml, { 'Content-Type': 'application/octet-stream' });
    }
  } else {
    console.log('   [4/5] Files already up to date.');
  }

  // 4. Upload function ZIP if needed
  if (requiredFns.length > 0) {
    console.log('   [5/5] Uploading Odoo function...');
    await apiRequest('PUT', `/deploys/${deployId}/functions/submit-results`, fnZip, {
      'Content-Type':        'application/zip',
      'Content-Length':      fnZip.length
    });
  } else {
    console.log('   [5/5] Function already up to date.');
  }

  // 5. Poll for ready
  console.log('\n   ⏳  Waiting for deploy to go live...');
  for (let i = 0; i < 24; i++) {
    await new Promise(r => setTimeout(r, 3000));
    const status = await apiRequest('GET', `/deploys/${deployId}`);
    const state  = status.body.state;
    process.stdout.write(`   state: ${state}          \r`);
    if (state === 'ready' || state === 'uploaded') {
      const url = status.body.ssl_url || status.body.url || `https://${SITE_NAME}.netlify.app`;
      console.log('\n\n   ✅  LIVE at: ' + url);
      console.log('   Odoo function: ' + url + '/.netlify/functions/submit-results\n');
      console.log('   ─────────────────────────────────────────────────────────');
      console.log('   Next: set Odoo env vars in Netlify Dashboard');
      console.log('   Site settings → Environment variables → Add:');
      console.log('     ODOO_URL      = https://yourcompany.odoo.com');
      console.log('     ODOO_DB       = your_database_name');
      console.log('     ODOO_USER     = your_login_email');
      console.log('     ODOO_API_KEY  = (Settings → Users → API Keys)');
      console.log('   ─────────────────────────────────────────────────────────\n');
      return;
    }
    if (state === 'error') throw new Error('Deploy failed: ' + status.body.error_message);
  }
  console.log(`\n   ✅  Deployed! Check: https://${SITE_NAME}.netlify.app\n`);
}

deploy().catch(e => { console.error('\n❌  Error:', e.message || e); process.exit(1); });
