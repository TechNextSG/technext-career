# tn_assessment — TechNext companion module for Odoo

Mirrors candidate-portal assessment results onto **`hr.applicant`** records.

The module is **optional**. The candidate portal at
[technext-career.vercel.app](https://technext-career.vercel.app) syncs to your
Odoo instance whether or not this module is installed — without it, every
submission still produces a structured chatter note on the matching
applicant. Installing this module just unlocks 14 `x_tn_*` fields you can
filter, sort, and group by inside Odoo's standard Recruitment views.

## What it adds

A **TechNext Assessment** page on the `hr.applicant` form:

| Group | Fields |
|---|---|
| **Profile** | `x_tn_role`, `x_tn_linkedin`, `x_tn_resume_url`, `x_tn_last_synced` |
| **DISC + 4-letter Type** | `x_tn_profiler_d_pct` / `_i_pct` / `_s_pct` / `_c_pct`, `x_tn_profiler_disc_primary`, `x_tn_profiler_disc_secondary`, `x_tn_profiler_mbti` |
| **Assessment scores** | `x_tn_company_quiz_pct`, `x_tn_reasoning_pct`, `x_tn_ai_technical_pct`, `x_tn_fc_technical_pct`, `x_tn_odoo_technical_pct`, `x_tn_cyber_technical_pct` |
| **Booking** | `x_tn_booking_slot` (UTC) |

All fields are nullable, read-only in the form view (writes come from the
portal API), and have no constraints — partial sync states are valid.

## Install

1. Copy `odoo-module/tn_assessment/` into your Odoo `addons/` folder (or any
   path on the server's `addons_path`).
2. Restart the Odoo service.
3. **Apps → Update Apps List**.
4. Search for **TechNext Assessment** and click **Install**.

If you're on Odoo.sh, place the folder under the repo's `custom_addons/`
path (or wherever your branch is configured to read addons from) and push.

## Configure the integration user

The portal authenticates with a dedicated Odoo user via XML-RPC + API Key.

1. In Odoo: **Settings → Users & Companies → Users → Create**.
2. Recommended login: `integration@technext.asia`. Access rights: at least
   *Recruitment: Recruiter*.
3. Log in as that user once, then go to **Profile → Account Security →
   New API Key**, copy it.
4. In Vercel (Project → Settings → Environment Variables → Production)
   set:
   ```
   ODOO_URL=https://<your-instance>.odoo.com
   ODOO_DB=<database name>
   ODOO_USER=integration@technext.asia
   ODOO_API_KEY=<the API key from step 3>
   ```
5. Optional (one ID per role you've created in **Recruitment → Configuration
   → Job Positions**):
   ```
   ODOO_JOB_AI_ENGINEER_ID=
   ODOO_JOB_FUNCTIONAL_CONSULTANT_ID=
   ODOO_JOB_ODOO_DEVELOPER_ID=
   ODOO_JOB_CYBER_SECURITY_ID=
   ```
   Unset values are skipped — the applicant is still created but without a
   `job_id`.

6. Redeploy Vercel, then **verify**:
   ```
   curl https://technext-career.vercel.app/api/odoo-ping
   ```
   Expect `{ "ok": true, "uid": <int>, "db": "...", "has_custom_fields": true }`.

## Compatibility

Tested with **Odoo 17.0**. Should work as-is on 16.0 and 18.0 since it
inherits `hr.applicant`, uses standard `fields.Char/Float/Datetime`, and the
view inheritance is on a stable selector (`//notebook`). If you're on an
older Odoo, the view xpath may need adjusting.

## Uninstall

**Apps → TechNext Assessment → Uninstall.** All `x_tn_*` field data is dropped
with the module. The candidate portal will detect their absence on the next
sync and fall back to chatter notes only. Supabase data is unaffected.
