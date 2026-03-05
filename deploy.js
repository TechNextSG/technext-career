/**
 * MUST Jobs — Netlify Deploy Script
 * Usage: node deploy.js YOUR_NETLIFY_TOKEN
 * Uses Netlify CLI (via npx) to deploy all files and functions.
 */
const { execSync } = require('child_process');

const TOKEN   = process.argv[2];
const SITE_ID = '6fcd95ee-435c-4a03-b578-40c0f92e5686';
const NPX     = 'node "' + process.env.APPDATA + '\\npm\\node_modules\\npm\\bin\\npx-cli.js"'
              + ' || node "C:\\nvm4w\\nodejs\\node_modules\\npm\\bin\\npx-cli.js"';

if (!TOKEN) {
  console.error('\n❌  Usage: node deploy.js YOUR_NETLIFY_TOKEN\n');
  process.exit(1);
}

console.log('\n🚀  MUST Jobs — Deploying to Netlify...\n');

try {
  const cmd = `node "C:\\nvm4w\\nodejs\\node_modules\\npm\\bin\\npx-cli.js" netlify deploy`
    + ` --auth ${TOKEN}`
    + ` --site ${SITE_ID}`
    + ` --dir .`
    + ` --functions netlify/functions`
    + ` --prod`
    + ` --json`;

  const output = execSync(cmd, { cwd: __dirname, stdio: ['pipe','pipe','pipe'], timeout: 120000 }).toString();
  const result = JSON.parse(output.trim().replace(/^[^{]*/,''));

  console.log('   ✅  LIVE at: ' + result.url + '\n');
  console.log('   Pages:');
  console.log('     Home (MUST Jobs):    ' + result.url + '/');
  console.log('     MUST Profiler:       ' + result.url + '/must_assessment.html');
  console.log('     IQ Test:             ' + result.url + '/iq_test.html');
  console.log('     Cyber Security Test: ' + result.url + '/cyber_test.html');
  console.log('     AI Competency Test:  ' + result.url + '/ai_test.html');
  console.log('     Admin Dashboard:     ' + result.url + '/admin.html');
  console.log('\n   ─────────────────────────────────────────────────────────');
  console.log('   ⚠  Set these env vars in Netlify Dashboard (Site settings → Env vars):');
  console.log('     SUPABASE_SERVICE_ROLE_KEY = <from Supabase dashboard → Settings → API>');
  console.log('     ADMIN_PASSWORD            = mustjobs2025  (or your own)');
  console.log('   ─────────────────────────────────────────────────────────\n');
} catch (err) {
  const out = err.stdout ? err.stdout.toString() : '';
  const stderr = err.stderr ? err.stderr.toString() : '';
  console.error('\n❌  Deploy failed.\n' + (stderr || out || err.message));
  process.exit(1);
}
