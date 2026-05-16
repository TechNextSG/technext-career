{
    'name': 'TechNext Assessment',
    'summary': 'Mirror TechNext candidate-portal assessment results onto hr.applicant.',
    'description': """
TechNext Assessment
===================

Companion module for the TechNext candidate portal at
https://technext-career.vercel.app.

Adds a "TechNext Assessment" page to the hr.applicant form view, plus a small
set of nullable ``x_tn_*`` fields that the candidate portal writes to via
XML-RPC each time a candidate submits a test:

* x_tn_role, x_tn_linkedin, x_tn_resume_url, x_tn_last_synced
* x_tn_company_quiz_pct
* x_tn_profiler_d_pct / _i_pct / _s_pct / _c_pct
* x_tn_profiler_disc_primary / _secondary
* x_tn_profiler_mbti
* x_tn_reasoning_pct
* x_tn_ai_technical_pct, x_tn_fc_technical_pct,
  x_tn_odoo_technical_pct, x_tn_cyber_technical_pct
* x_tn_booking_slot

The module is OPTIONAL. The portal's Odoo sync also posts a chatter note on
every submission, so even without installing this module recruiters get full
visibility on hr.applicant — installation just unlocks structured fields you
can filter and group by inside Odoo.
""",
    'version': '17.0.1.0.0',
    'category': 'Human Resources/Recruitment',
    'author': 'TechNext',
    'website': 'https://technext.asia',
    'license': 'LGPL-3',
    'depends': ['hr_recruitment', 'mail'],
    'data': [
        'views/hr_applicant_view.xml',
    ],
    'installable': True,
    'application': False,
    'auto_install': False,
}
