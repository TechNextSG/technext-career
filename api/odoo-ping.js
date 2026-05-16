'use strict';
/**
 * GET /api/odoo-ping
 *
 * Smoke test for the Odoo integration. Authenticates against Odoo with the
 * configured ODOO_* env vars and reports back the uid + whether the optional
 * tn_assessment companion module is installed (by checking for any
 * `x_tn_*` fields on hr.applicant).
 *
 * Used right after a deploy or env-var change to confirm credentials +
 * network reachability without touching candidate data.
 *
 *   curl https://technext-career.vercel.app/api/odoo-ping
 *   → { ok: true, uid: 7, url: 'https://...', db: '...', has_custom_fields: true, custom_field_count: 14, sync_enabled: true }
 *
 * Returns 503 with { ok: false, error } on any failure (auth, network, config).
 */

const { pingOdoo } = require('./_odoo');

module.exports = async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Cache-Control', 'no-store, max-age=0');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'GET') return res.status(405).json({ ok: false, error: 'Method not allowed' });

  try {
    const result = await pingOdoo();
    return res.status(result.ok ? 200 : 503).json(result);
  } catch (err) {
    console.error('odoo-ping failure:', err && err.message);
    return res.status(503).json({ ok: false, error: (err && err.message) || 'Unknown error' });
  }
};
