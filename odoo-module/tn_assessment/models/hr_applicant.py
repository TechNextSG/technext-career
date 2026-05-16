# -*- coding: utf-8 -*-
"""
TechNext custom fields on hr.applicant.

Every field is nullable, has no constraints, and is written to by the
candidate portal's `/api/_odoo.js` sync routine. The portal pre-fetches
the list of `x_tn_*` fields per warm container and only writes those
that actually exist, so leaving any of these off has no effect beyond
that field not appearing in Odoo.
"""

from odoo import fields, models


class HrApplicant(models.Model):
    _inherit = 'hr.applicant'

    # ── Identity / link-back ───────────────────────────────────────────
    x_tn_role = fields.Char(
        string="TechNext Role Slug",
        help="The role slug the candidate applied for: ai-engineer, "
             "functional-consultant, odoo-developer, or cyber-security.",
    )
    x_tn_linkedin = fields.Char(
        string="LinkedIn URL",
        help="Candidate-supplied LinkedIn profile URL (optional).",
    )
    x_tn_resume_url = fields.Char(
        string="Resume URL",
        help="Public Supabase Storage URL of the uploaded resume. The "
             "first sync also attaches the file directly as ir.attachment.",
    )
    x_tn_last_synced = fields.Datetime(
        string="Last TechNext Sync",
        help="UTC timestamp of the most recent sync from the candidate portal.",
    )

    # ── About TechNext quiz ────────────────────────────────────────────
    x_tn_company_quiz_pct = fields.Float(string="About TechNext (%)", digits=(5, 1))

    # ── Profiler — DISC dimensions ─────────────────────────────────────
    x_tn_profiler_d_pct = fields.Float(string="DISC · D (%)", digits=(5, 1))
    x_tn_profiler_i_pct = fields.Float(string="DISC · I (%)", digits=(5, 1))
    x_tn_profiler_s_pct = fields.Float(string="DISC · S (%)", digits=(5, 1))
    x_tn_profiler_c_pct = fields.Float(string="DISC · C (%)", digits=(5, 1))
    x_tn_profiler_disc_primary = fields.Char(string="DISC Primary")
    x_tn_profiler_disc_secondary = fields.Char(string="DISC Secondary")
    x_tn_profiler_mbti = fields.Char(string="4-letter Type")

    # ── Technical / reasoning scores ───────────────────────────────────
    x_tn_reasoning_pct      = fields.Float(string="Reasoning (%)",            digits=(5, 1))
    x_tn_ai_technical_pct   = fields.Float(string="AI Engineer Tech (%)",     digits=(5, 1))
    x_tn_fc_technical_pct   = fields.Float(string="FC / BA Tech (%)",         digits=(5, 1))
    x_tn_odoo_technical_pct = fields.Float(string="Odoo Developer Tech (%)",  digits=(5, 1))
    x_tn_cyber_technical_pct = fields.Float(string="Cyber Security Tech (%)", digits=(5, 1))

    # ── Booking ────────────────────────────────────────────────────────
    x_tn_booking_slot = fields.Datetime(
        string="Interview Slot (UTC)",
        help="Slot the candidate expressed interest in via the portal. "
             "Confirmation is sent separately by email or handphone — this "
             "is not a confirmed appointment.",
    )
