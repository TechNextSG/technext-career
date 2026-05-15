/* TechNext shared client-side helpers. Used by every page in /technext.
 * Globally exposed as `window.TN`. No build step; ES2017+. */
(function () {
  'use strict';

  var ROLES = {
    'ai-engineer': {
      label: 'AI Engineer',
      icon: '🤖',
      blurb: 'Design, build, and deploy LLM-powered systems — RAG, agents, evaluation, fine-tuning.',
      tests: [
        { slug: 'company-quiz', test_type: 'tn_company_quiz', label: 'About TechNext',            path: '/technext/quiz',           desc: 'Learn who we are + short recall quiz · 10 questions · ~5 min' },
        { slug: 'profiler',     test_type: 'tn_profiler',     label: 'TechNext Profiler',         path: '/technext/profiler',       desc: 'Personality · DISC + Type · 32 questions · ~12 min' },
        { slug: 'iq',           test_type: 'tn_iq',           label: 'Reasoning Test',            path: '/technext/iq',             desc: 'Numerical, verbal, logical · 25 questions · 35 min' },
        { slug: 'ai-technical', test_type: 'tn_ai_technical', label: 'AI Engineer — Technical',   path: '/technext/ai-technical',   desc: 'Transformers, RAG, agents · 25 questions · 40 min' }
      ]
    },
    'functional-consultant': {
      label: 'Functional Consultant / Business Analyst',
      icon: '🧭',
      blurb: 'Translate business needs into working ERP solutions — discovery, modelling, configuration, UAT.',
      tests: [
        { slug: 'company-quiz', test_type: 'tn_company_quiz', label: 'About TechNext',                     path: '/technext/quiz',         desc: 'Learn who we are + short recall quiz · 10 questions · ~5 min' },
        { slug: 'profiler',     test_type: 'tn_profiler',     label: 'TechNext Profiler',                  path: '/technext/profiler',     desc: 'Personality · DISC + Type · 32 questions · ~12 min' },
        { slug: 'iq',           test_type: 'tn_iq',           label: 'Reasoning Test',                     path: '/technext/iq',           desc: 'Numerical, verbal, logical · 25 questions · 35 min' },
        { slug: 'fc-technical', test_type: 'tn_fc_technical', label: 'Functional Consultant — Technical',  path: '/technext/fc-technical', desc: 'Requirements, BPMN, ERP · 20 questions · 30 min' }
      ]
    },
    'odoo-developer': {
      label: 'Odoo Developer',
      icon: '🧰',
      blurb: 'Build Odoo modules — Python, ORM, views, security, QWeb, integration.',
      tests: [
        { slug: 'company-quiz',   test_type: 'tn_company_quiz',   label: 'About TechNext',             path: '/technext/quiz',           desc: 'Learn who we are + short recall quiz · 10 questions · ~5 min' },
        { slug: 'profiler',       test_type: 'tn_profiler',       label: 'TechNext Profiler',          path: '/technext/profiler',       desc: 'Personality · DISC + Type · 32 questions · ~12 min' },
        { slug: 'iq',             test_type: 'tn_iq',             label: 'Reasoning Test',             path: '/technext/iq',             desc: 'Numerical, verbal, logical · 25 questions · 35 min' },
        { slug: 'odoo-technical', test_type: 'tn_odoo_technical', label: 'Odoo Developer — Technical', path: '/technext/odoo-technical', desc: 'Python, ORM, views, security · 20 questions · 35 min' }
      ]
    },
    'cyber-security': {
      label: 'Cyber Security',
      icon: '🛡️',
      blurb: 'Protect systems and data — cryptography, network security, web/app security, identity, detection & response.',
      tests: [
        { slug: 'company-quiz',    test_type: 'tn_company_quiz',    label: 'About TechNext',             path: '/technext/quiz',            desc: 'Learn who we are + short recall quiz · 10 questions · ~5 min' },
        { slug: 'profiler',        test_type: 'tn_profiler',        label: 'TechNext Profiler',          path: '/technext/profiler',        desc: 'Personality · DISC + Type · 32 questions · ~12 min' },
        { slug: 'iq',              test_type: 'tn_iq',              label: 'Reasoning Test',             path: '/technext/iq',              desc: 'Numerical, verbal, logical · 25 questions · 35 min' },
        { slug: 'cyber-technical', test_type: 'tn_cyber_technical', label: 'Cyber Security — Technical', path: '/technext/cyber-technical', desc: 'Crypto, network, web, IAM, IR · 26 questions · 40 min' }
      ]
    }
  };

  var STORAGE = {
    email:     'tn_email',
    phone:     'tn_phone',
    name:      'tn_name',
    linkedin:  'tn_linkedin',
    resumeUrl: 'tn_resume_url',
    role:      'tn_role',
    doneKey:   function (role, slug) { return 'tn_done_' + role + '_' + slug; }
  };

  var INTERVIEW_EMAIL = 'career@technext.asia';

  /* ── DOM helpers ─────────────────────────────────────────── */
  function $(id) { return document.getElementById(id); }
  function esc(s) { return String(s == null ? '' : s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;'); }

  function showScreen(id) {
    var screens = document.querySelectorAll('.tn-screen');
    for (var i = 0; i < screens.length; i++) screens[i].classList.remove('active');
    var el = $(id); if (el) el.classList.add('active');
    window.scrollTo(0, 0);
  }

  function toast(msg, kind) {
    var t = $('tn-toast');
    if (!t) {
      t = document.createElement('div');
      t.id = 'tn-toast';
      t.className = 'tn-toast';
      document.body.appendChild(t);
    }
    t.className = 'tn-toast ' + (kind || '');
    t.textContent = msg;
    setTimeout(function () { t.classList.add('show'); }, 10);
    clearTimeout(t._h);
    t._h = setTimeout(function () { t.classList.remove('show'); }, 3000);
  }

  /* ── Validation ──────────────────────────────────────────── */
  function isEmail(v) { return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v); }
  function isPhone(v) { return v && v.replace(/[^0-9]/g, '').length >= 7; }
  function isUrl(v) { return !v || /^https?:\/\/[^\s]+$/i.test(v); }

  /* ── Candidate info form ─────────────────────────────────── */
  /** Render the candidate info screen into an element, with the given role.
   * onSuccess fires with the validated candidate object after save. */
  function renderInfoForm(el, opts) {
    opts = opts || {};
    var role = opts.role || localStorage.getItem(STORAGE.role) || '';
    var roleLabel = role && ROLES[role] ? ROLES[role].label : 'TechNext';

    el.innerHTML =
      '<div class="tn-card">' +
        '<h2>Your details</h2>' +
        '<p class="sub">You\'re applying for <strong>' + esc(roleLabel) + '</strong>. Only email and handphone are required — everything else helps us, but is optional.</p>' +
        '<div class="tn-error" id="tn-info-err"></div>' +
        '<div class="tn-field"><label>Email <span class="req">*</span></label>' +
          '<input id="tn-inp-email" type="email" placeholder="e.g. ahmad@email.com" autocomplete="email" inputmode="email" /></div>' +
        '<div class="tn-field"><label>Handphone <span class="req">*</span></label>' +
          '<input id="tn-inp-phone" type="tel" placeholder="e.g. +60 12-345 6789" autocomplete="tel" inputmode="tel" /></div>' +
        '<div class="tn-field"><label>Name <span class="opt">(optional)</span></label>' +
          '<input id="tn-inp-name" type="text" placeholder="Your full name" autocomplete="name" /></div>' +
        '<div class="tn-field"><label>LinkedIn profile <span class="opt">(optional)</span></label>' +
          '<input id="tn-inp-linkedin" type="url" placeholder="https://www.linkedin.com/in/your-handle" autocomplete="url" /></div>' +
        '<div class="tn-field"><label>Resume <span class="opt">(optional · PDF or DOC, max 4MB)</span></label>' +
          '<input id="tn-inp-resume" type="file" accept=".pdf,.doc,.docx,application/pdf,application/msword,application/vnd.openxmlformats-officedocument.wordprocessingml.document" />' +
          '<div class="file-info" id="tn-resume-info"></div></div>' +
        '<button class="tn-btn primary block lg" id="tn-info-submit">Continue →</button>' +
      '</div>';

    // Pre-fill from storage
    $('tn-inp-email').value    = localStorage.getItem(STORAGE.email)    || '';
    $('tn-inp-phone').value    = localStorage.getItem(STORAGE.phone)    || '';
    $('tn-inp-name').value     = localStorage.getItem(STORAGE.name)     || '';
    $('tn-inp-linkedin').value = localStorage.getItem(STORAGE.linkedin) || '';
    var existingResume = localStorage.getItem(STORAGE.resumeUrl);
    if (existingResume) {
      $('tn-resume-info').textContent = '✓ Resume on file. Upload a new one to replace.';
      $('tn-resume-info').classList.add('show');
    }

    $('tn-info-submit').addEventListener('click', function () {
      submit();
    });
    var fields = ['tn-inp-email','tn-inp-phone','tn-inp-name','tn-inp-linkedin'];
    fields.forEach(function (id) {
      var input = $(id);
      input.addEventListener('keydown', function (e) { if (e.key === 'Enter') submit(); });
    });

    function submit() {
      var err = $('tn-info-err');
      err.classList.remove('show'); err.textContent = '';

      var email    = $('tn-inp-email').value.trim();
      var phone    = $('tn-inp-phone').value.trim();
      var name     = $('tn-inp-name').value.trim();
      var linkedin = $('tn-inp-linkedin').value.trim();
      var file     = $('tn-inp-resume').files[0];

      if (!isEmail(email)) { showErr('Please enter a valid email address.'); $('tn-inp-email').classList.add('err'); $('tn-inp-email').focus(); return; }
      $('tn-inp-email').classList.remove('err');
      if (!isPhone(phone)) { showErr('Please enter a valid handphone number.'); $('tn-inp-phone').classList.add('err'); $('tn-inp-phone').focus(); return; }
      $('tn-inp-phone').classList.remove('err');
      if (linkedin && !isUrl(linkedin)) { showErr('LinkedIn URL must start with http(s)://'); $('tn-inp-linkedin').classList.add('err'); $('tn-inp-linkedin').focus(); return; }
      $('tn-inp-linkedin').classList.remove('err');
      if (file && file.size > 4 * 1024 * 1024) { showErr('Resume file must be under 4MB.'); $('tn-inp-resume').focus(); return; }

      localStorage.setItem(STORAGE.email, email);
      localStorage.setItem(STORAGE.phone, phone);
      localStorage.setItem(STORAGE.name, name);
      localStorage.setItem(STORAGE.linkedin, linkedin);
      if (role) localStorage.setItem(STORAGE.role, role);

      var candidate = { email: email, phone: phone, name: name, linkedin: linkedin, role: role, resume_url: localStorage.getItem(STORAGE.resumeUrl) || '' };

      if (!file) { return done(candidate); }
      // Upload resume → /api/upload-resume
      var btn = $('tn-info-submit');
      btn.disabled = true; btn.textContent = 'Uploading resume…';
      uploadResume(file).then(function (url) {
        localStorage.setItem(STORAGE.resumeUrl, url);
        candidate.resume_url = url;
        done(candidate);
      }).catch(function (e) {
        btn.disabled = false; btn.textContent = 'Continue →';
        showErr('Resume upload failed: ' + (e && e.message ? e.message : 'unknown'));
      });

      function showErr(m) { err.textContent = m; err.classList.add('show'); }
      function done(c) { if (opts.onSuccess) opts.onSuccess(c); }
    }
  }

  /* ── Resume upload (base64 → /api/upload-resume) ─────────── */
  function uploadResume(file) {
    return new Promise(function (resolve, reject) {
      var r = new FileReader();
      r.onerror = function () { reject(new Error('Could not read file.')); };
      r.onload = function () {
        var b64 = String(r.result).split(',')[1];
        fetch('/api/upload-resume', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ filename: file.name, contentType: file.type || 'application/octet-stream', base64: b64 })
        }).then(function (res) {
          return res.json().then(function (j) { return { ok: res.ok, body: j }; });
        }).then(function (out) {
          if (!out.ok) return reject(new Error(out.body && out.body.error ? out.body.error : 'Upload failed'));
          if (!out.body || !out.body.url) return reject(new Error('Upload returned no URL'));
          resolve(out.body.url);
        }).catch(function (e) { reject(e); });
      };
      r.readAsDataURL(file);
    });
  }

  /* ── Test submission ─────────────────────────────────────── */
  function submitTest(payload) {
    // Merge in identity from localStorage
    payload.candidate_email     = payload.candidate_email     || localStorage.getItem(STORAGE.email) || '';
    payload.candidate_phone     = payload.candidate_phone     || localStorage.getItem(STORAGE.phone) || '';
    payload.candidate_name      = payload.candidate_name      || localStorage.getItem(STORAGE.name)  || localStorage.getItem(STORAGE.email) || 'Anonymous';
    payload.candidate_linkedin  = payload.candidate_linkedin  || localStorage.getItem(STORAGE.linkedin)  || '';
    payload.candidate_resume_url= payload.candidate_resume_url|| localStorage.getItem(STORAGE.resumeUrl) || '';
    payload.candidate_role      = payload.candidate_role      || localStorage.getItem(STORAGE.role)      || '';
    return fetch('/api/submit-test', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    }).then(function (r) { return r.json().then(function (j) { return { ok: r.ok, body: j }; }); });
  }

  /* ── Role / progress tracking ────────────────────────────── */
  function markDone(role, slug) {
    if (role && slug) localStorage.setItem(STORAGE.doneKey(role, slug), '1');
  }
  function isDone(role, slug) {
    return localStorage.getItem(STORAGE.doneKey(role, slug)) === '1';
  }
  function allDone(role) {
    if (!ROLES[role]) return false;
    return ROLES[role].tests.every(function (t) { return isDone(role, t.slug); });
  }
  function nextPending(role) {
    if (!ROLES[role]) return null;
    return ROLES[role].tests.find(function (t) { return !isDone(role, t.slug); }) || null;
  }
  function resetRole(role) {
    if (!ROLES[role]) return;
    ROLES[role].tests.forEach(function (t) { localStorage.removeItem(STORAGE.doneKey(role, t.slug)); });
  }

  /* ── Booking helpers ─────────────────────────────────────── */
  // Generate booking days. Times depend on day-of-week:
  //   Mon–Fri: 09:00, 11:00, 14:00, 16:00
  //   Sat:     10:00, 11:00, 12:00, 13:00
  //   Sun:     skipped
  // Returns an array of { date: Date, times: [Date,...] }, one entry per available day.
  function generateBookingDays(daysToInclude) {
    daysToInclude = daysToInclude || 12; // ~2 weeks of weekdays + Saturdays
    var WEEKDAY_TIMES = ['09:00','11:00','14:00','16:00'];
    var SATURDAY_TIMES = ['10:00','11:00','12:00','13:00'];
    var out = [];
    var now = new Date();
    for (var i = 1; out.length < daysToInclude && i < 28; i++) {
      var d = new Date(now.getFullYear(), now.getMonth(), now.getDate() + i);
      var dow = d.getDay();
      if (dow === 0) continue; // Sunday: skip
      var times = (dow === 6 ? SATURDAY_TIMES : WEEKDAY_TIMES);
      var slots = times.map(function (hhmm) {
        var parts = hhmm.split(':');
        return new Date(d.getFullYear(), d.getMonth(), d.getDate(), parseInt(parts[0],10), parseInt(parts[1],10));
      });
      out.push({ date: d, times: slots, isSaturday: dow === 6 });
    }
    return out;
  }
  // Backward-compat: previous flat-list API.
  function generateSlots(daysAhead, times) {
    return generateBookingDays(daysAhead).reduce(function (acc, d) {
      return acc.concat(d.times);
    }, []);
  }
  function fmtSlotDay(d) { return d.toLocaleDateString('en-GB', { weekday: 'short' }); }
  function fmtSlotDate(d) { return d.toLocaleDateString('en-GB', { day: '2-digit', month: 'short' }); }
  function fmtSlotTime(d) { return d.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit', hour12: false }); }
  function pad(n) { return n < 10 ? '0' + n : '' + n; }
  function gcalUTCString(d) {
    // YYYYMMDDTHHmmssZ in UTC
    return d.getUTCFullYear()
      + pad(d.getUTCMonth()+1)
      + pad(d.getUTCDate())
      + 'T'
      + pad(d.getUTCHours()) + pad(d.getUTCMinutes()) + pad(d.getUTCSeconds())
      + 'Z';
  }
  function buildGcalLink(slot, durationMin, role, candidate) {
    var end = new Date(slot.getTime() + (durationMin || 45) * 60000);
    var roleLabel = role && ROLES[role] ? ROLES[role].label : 'TechNext';
    var title = 'TechNext Interview — ' + roleLabel + (candidate.name ? ' — ' + candidate.name : '');
    var details = [
      'TechNext interview booked through the candidate portal.',
      '',
      'Candidate: ' + (candidate.name || '(no name)'),
      'Email: ' + (candidate.email || ''),
      'Handphone: ' + (candidate.phone || ''),
      'LinkedIn: ' + (candidate.linkedin || '(none)'),
      'Resume: ' + (candidate.resume_url || '(not uploaded)'),
      'Role: ' + roleLabel,
      '',
      'Booked at ' + new Date().toISOString()
    ].join('\n');
    var params = new URLSearchParams({
      action: 'TEMPLATE',
      text: title,
      dates: gcalUTCString(slot) + '/' + gcalUTCString(end),
      details: details,
      add: INTERVIEW_EMAIL
    });
    return 'https://calendar.google.com/calendar/render?' + params.toString();
  }

  /* ── Celebration animation ───────────────────────────────── */
  // Show a celebratory banner + confetti burst. Loads canvas-confetti
  // from CDN on first use so we don't pay the cost up-front.
  function celebrate(opts) {
    opts = opts || {};
    var title = opts.title || 'Amazing — you did it! 🎉';
    var subtitle = opts.subtitle || 'Test completed.';

    // Banner
    var banner = document.createElement('div');
    banner.className = 'tn-celebrate';
    banner.innerHTML =
      '<span class="tn-celebrate-ic">🎉</span>' +
      '<div class="tn-celebrate-msg">' +
        '<div class="tn-celebrate-title">' + esc(title) + '</div>' +
        '<div class="tn-celebrate-sub">' + esc(subtitle) + '</div>' +
      '</div>';
    document.body.appendChild(banner);
    setTimeout(function () { banner.classList.add('show'); }, 30);
    setTimeout(function () {
      banner.classList.remove('show');
      setTimeout(function () { banner.remove(); }, 400);
    }, 3200);

    function runConfetti() {
      if (!window.confetti) return;
      var end = Date.now() + 1400;
      (function frame() {
        window.confetti({ particleCount: 6, angle: 60,  spread: 60, startVelocity: 50, origin: { x: 0, y: 0.85 } });
        window.confetti({ particleCount: 6, angle: 120, spread: 60, startVelocity: 50, origin: { x: 1, y: 0.85 } });
        if (Date.now() < end) requestAnimationFrame(frame);
      })();
      // Final centre burst
      window.confetti({ particleCount: 80, spread: 70, origin: { y: 0.55 } });
    }

    if (window.confetti) {
      runConfetti();
    } else {
      var s = document.createElement('script');
      s.src = 'https://cdn.jsdelivr.net/npm/canvas-confetti@1.9.3/dist/confetti.browser.min.js';
      s.async = true;
      s.onload = runConfetti;
      document.head.appendChild(s);
    }
  }

  /* ── Public API ──────────────────────────────────────────── */
  window.TN = {
    ROLES: ROLES,
    STORAGE: STORAGE,
    INTERVIEW_EMAIL: INTERVIEW_EMAIL,
    $:$, esc: esc,
    showScreen: showScreen,
    toast: toast,
    celebrate: celebrate,
    renderInfoForm: renderInfoForm,
    uploadResume: uploadResume,
    submitTest: submitTest,
    markDone: markDone,
    isDone: isDone,
    allDone: allDone,
    nextPending: nextPending,
    resetRole: resetRole,
    generateSlots: generateSlots,
    generateBookingDays: generateBookingDays,
    fmtSlotDay: fmtSlotDay,
    fmtSlotDate: fmtSlotDate,
    fmtSlotTime: fmtSlotTime,
    buildGcalLink: buildGcalLink
  };
})();
