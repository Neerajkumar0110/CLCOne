const mongoose = require('mongoose');
const LOGO = require('./enquiryLogo');

// The public capture form, built from the CaptureFormConfig the Form Builder
// (Marketing › Capture Form › Form Builder) saves:
//
//   GET /public/lead-form/:platform?        the hosted page (ads, YouTube / LinkedIn links, QR)
//   GET /public/lead-form/:platform/config  the same form as JSON
//   GET /public/lead-form/embed.js          <script> that puts the form on any website
//
// The page looks the same as the Form Builder's live preview: the same
// sections, order, required marks, button text and thank-you message.

// Used until a form has been saved, so the page is never blank.
const DEFAULT_FIELDS = [
  { key: 'name', label: 'Full name', type: 'Text', enabled: true, required: true, section: 'personal' },
  { key: 'phone', label: 'Phone number', type: 'Phone', enabled: true, required: true, section: 'personal' },
  { key: 'email', label: 'Email address', type: 'Email', enabled: true, section: 'personal' },
  { key: 'whatsapp', label: 'WhatsApp number', type: 'Phone', enabled: false, section: 'personal' },
  { key: 'city', label: 'City', type: 'Text', enabled: true, section: 'personal' },
  { key: 'course', label: 'Internship / interest', type: 'Dropdown', enabled: true, required: true, section: 'lead' },
  { key: 'source', label: 'How did you hear about us?', type: 'Dropdown', enabled: true, section: 'lead' },
  { key: 'budget', label: 'Budget range', type: 'Dropdown', enabled: false, section: 'additional' },
  { key: 'howSoon', label: 'How soon to start?', type: 'Dropdown', enabled: false, section: 'additional' },
  { key: 'message', label: 'Message', type: 'Textarea', enabled: false, section: 'additional' },
  { key: 'consent', label: 'I agree to be contacted by call, SMS or WhatsApp.', type: 'Checkbox', enabled: true, required: true, section: 'additional' },
];

const DEFAULT_OPTIONS = {
  course: ['Data Science & AI', 'Data Analytics', 'Full Stack Development', 'Digital Marketing', 'Business Analytics', 'Other'],
  source: ['YouTube', 'LinkedIn', 'Facebook', 'Instagram', 'Google Search', 'Referral', 'Other'],
  budget: ['Under ₹10,000', '₹10,000 – ₹25,000', '₹25,000 – ₹50,000', '₹50,000+'],
  howSoon: ['Immediate', 'Within 1 Week', 'Within 15 Days', 'Within 30 Days', 'Just exploring'],
};

const DEFAULT_COPY = {
  headline: 'Start your AI career',
  subtext: 'Leave your details — a counsellor calls you back.',
  buttonText: 'Get a call back',
  thankYouMessage: 'Thanks! Our counsellor will call you within 24 hours.',
};

const SECTIONS = [
  ['personal', 'PERSONAL INFORMATION'],
  ['lead', 'LEAD INFORMATION'],
  ['additional', 'ADDITIONAL INFORMATION'],
];

const esc = (s) =>
  String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

const platformOf = (p) => (p === 'facebook' ? 'Facebook Ads' : 'Website');

// The saved form (enabled fields in their saved order) + its copy.
async function loadForm(platform) {
  let cfg = null;
  try {
    cfg = await mongoose.model('CaptureFormConfig').findOne({ platform, removed: false }).lean();
  } catch {
    /* DB hiccup: defaults below */
  }
  const saved = (cfg && cfg.fields) || [];
  const fields = (saved.length ? saved : DEFAULT_FIELDS)
    .filter((f) => f.enabled)
    .map((f, i) => {
      const d = DEFAULT_FIELDS.find((x) => x.key === f.key) || {};
      return {
        key: f.key,
        label: f.label || d.label || f.key,
        type: f.type || d.type || 'Text',
        required: !!(f.required || f.key === 'name' || f.key === 'phone'),
        section: f.section || d.section || 'additional',
        options: f.options && f.options.length ? f.options : DEFAULT_OPTIONS[f.key] || [],
        placeholder: f.placeholder || '',
        sortOrder: f.sortOrder == null ? i : f.sortOrder,
      };
    })
    .sort((a, b) => a.sortOrder - b.sortOrder);
  const copy = {};
  for (const k of Object.keys(DEFAULT_COPY)) copy[k] = (cfg && cfg[k] && String(cfg[k]).trim()) || DEFAULT_COPY[k];
  return { fields, copy };
}

const PLACEHOLDER = { name: 'Your full name', email: 'name@example.com', city: 'Your city', phone: '98765 43210', whatsapp: '98765 43210' };

function control(f) {
  const req = f.required ? ' required' : '';
  const name = esc(f.key);
  const ph = esc(f.placeholder || PLACEHOLDER[f.key] || '');
  if (f.type === 'Textarea') return `<textarea name="${name}" rows="3" placeholder="${ph}"${req}></textarea>`;
  if (f.type === 'Dropdown') {
    const opts = f.options.map((o) => `<option value="${esc(o)}">${esc(o)}</option>`).join('');
    return `<span class="sel"><select name="${name}"${req}><option value="">${esc(f.placeholder || 'Choose one')}</option>${opts}</select></span>`;
  }
  if (f.type === 'Phone' || f.type === 'WhatsApp' || f.key === 'phone' || f.key === 'whatsapp') {
    return `<span class="in tel"><span class="cc">+91</span><input type="tel" inputmode="numeric" maxlength="14" name="${name}" placeholder="${ph}" data-phone="1"${req} /></span>`;
  }
  const type = f.type === 'Email' ? 'email' : f.type === 'Number' ? 'number' : 'text';
  return `<input type="${type}" name="${name}" placeholder="${ph}"${req} />`;
}

function fieldHtml(f) {
  const star = f.required ? ' <span class="req">*</span>' : '';
  const label = f.key.startsWith('custom_') ? `<input type="hidden" name="${esc(f.key)}__label" value="${esc(f.label)}" />` : '';
  if (f.type === 'Checkbox') {
    return `<label class="chk"><input type="checkbox" name="${esc(f.key)}" value="yes"${f.required ? ' required' : ''} /> <span>${esc(f.label)}</span></label>${label}`;
  }
  return `<label class="fld"><span>${esc(f.label)}${star}</span>${control(f)}<span class="err" hidden></span></label>${label}`;
}

// GET /public/lead-form/:platform?
const renderLeadFormPage = async (req, res) => {
  const platform = platformOf(req.params.platform);
  const { fields, copy } = await loadForm(platform);
  const q = req.query || {};
  const embed = q.embed === '1';
  const attrKeys = ['utm_source', 'utm_medium', 'utm_campaign', 'utm_content', 'utm_term', 'gclid', 'fbclid', 'campaign', 'platform'];
  const hidden = attrKeys
    .filter((k) => q[k])
    .map((k) => `<input type="hidden" name="${k}" value="${esc(q[k])}" />`)
    .join('');

  const heading = esc(q.headline || copy.headline);
  const sub = esc(q.subtext || copy.subtext);
  const body = SECTIONS.map(([key, title]) => {
    const inSec = fields.filter((f) => f.section === key);
    if (!inSec.length) return '';
    const head = inSec.every((f) => f.type === 'Checkbox') ? '' : `<div class="sec">${title}</div>`;
    return head + inSec.map(fieldHtml).join('');
  }).join('');

  const html = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<meta name="robots" content="noindex" />
<title>${heading} — Career Lab Consulting</title>
<link rel="icon" type="image/png" href="${LOGO}" />
<link rel="preconnect" href="https://fonts.googleapis.com" />
<link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&family=Space+Grotesk:wght@700&display=swap" rel="stylesheet" />
<style>
  *{box-sizing:border-box}
  [hidden]{display:none!important}
  body{margin:0;font-family:Inter,system-ui,-apple-system,"Segoe UI",Roboto,sans-serif;background:${embed ? 'transparent' : '#F5F7FB'};color:#0F172A;
    ${embed ? '' : 'min-height:100vh;display:flex;align-items:center;justify-content:center;padding:24px 16px'}}
  .card{min-width:0;width:100%;max-width:${embed ? '100%' : '480px'};background:#FFFFFF;border:1px solid #E4E9F0;border-radius:20px;padding:26px;
    box-shadow:${embed ? 'none' : '0 18px 40px rgba(15,23,42,.08)'};display:flex;flex-direction:column;gap:16px}
  .brand{display:flex;align-items:center;gap:10px;font-weight:700;font-size:13px;letter-spacing:.04em}
  .brand img{width:30px;height:30px}
  h1{margin:0 0 4px;font:700 22px/1.25 'Space Grotesk',Inter,sans-serif}
  .sub{margin:0;color:#5B6B7F;font-size:13.5px}
  form{display:flex;flex-direction:column;gap:16px}
  .sec{font-size:11.5px;font-weight:700;color:#5B6B7F;letter-spacing:.06em;margin-top:4px}
  .fld{display:flex;flex-direction:column;gap:6px;font-size:13px;font-weight:600;color:#1E293B}
  .req{color:#D92D20}
  input:not([type=checkbox]),select,textarea{min-height:46px;border:1px solid #D9E0EA;border-radius:11px;padding:0 14px;font:400 14px Inter,sans-serif;color:#0F172A;background:#FFFFFF;width:100%}
  textarea{padding:12px 14px;resize:vertical}
  .sel{position:relative;display:block}
  select{appearance:none;-webkit-appearance:none;padding-right:36px;cursor:pointer}
  .sel::after{content:"\\25BE";position:absolute;right:14px;top:50%;transform:translateY(-50%);color:#5B6B7F;pointer-events:none}
  .in.tel{display:flex;align-items:center;gap:10px;min-height:46px;border:1px solid #D9E0EA;border-radius:11px;padding:0 14px;background:#FFFFFF}
  .in.tel input{border:0;min-height:44px;padding:0;outline:0}
  .cc{color:#5B6B7F;font-weight:500}
  input:focus,select:focus,textarea:focus,.in.tel:focus-within{outline:none;border-color:#2563EB;box-shadow:0 0 0 3px #EEF3FF}
  .bad input:not([type=checkbox]),.bad select,.bad .in.tel{border-color:#D92D20;box-shadow:0 0 0 3px #FDECEC}
  .err{font-size:12px;font-weight:500;color:#B42318}
  .chk{display:flex;gap:10px;align-items:flex-start;font-size:12.5px;color:#3E4C5E}
  .chk input{width:18px;height:18px;margin:1px 0 0;flex:none;accent-color:#2563EB}
  .hp{position:absolute;left:-9999px;width:1px;height:1px;overflow:hidden}
  button{width:100%;min-height:48px;border:0;border-radius:11px;background:#2563EB;color:#FFFFFF;font:600 15px Inter,sans-serif;cursor:pointer}
  button:hover{background:#1D4ED8}
  button:disabled{opacity:.6;cursor:progress}
  .form-err{color:#B42318;font-size:12.5px;font-weight:600;min-height:0}
  .ok{display:flex;gap:12px;align-items:center;background:#E7F6EF;border:1px solid #BFE6D2;border-radius:14px;padding:14px 16px;font-size:13.5px;color:#0B5F3F}
  .ok svg{flex:none}
</style>
</head>
<body>
  <div class="card">
    <div>
      <div class="brand"><img src="${LOGO}" alt="" />CAREER LAB CONSULTING</div>
      <h1 style="margin-top:14px">${heading}</h1>
      <p class="sub">${sub}</p>
    </div>
    <form id="f" novalidate>
      <div class="hp"><label>Company Website<input type="text" name="company_website" tabindex="-1" autocomplete="off" /></label></div>
      ${hidden}
      <input type="hidden" name="landing_page" value="" />
      ${body}
      <div class="form-err" id="e" role="alert"></div>
      <button type="submit" id="b">${esc(copy.buttonText)}</button>
    </form>
    <div class="ok" id="ok" hidden role="status">
      <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"></path><polyline points="22 4 12 14.01 9 11.01"></polyline></svg>
      <span>${esc(copy.thankYouMessage)}</span>
    </div>
  </div>
<script>
  (function () {
    var f = document.getElementById('f'), ok = document.getElementById('ok'), b = document.getElementById('b'), e = document.getElementById('e');
    var label = b.textContent;
    var lp = f.querySelector('input[name=landing_page]');
    if (lp) lp.value = ${embed ? "document.referrer || location.href" : 'location.href'};
    var qs = new URLSearchParams(location.search);
    ['utm_source','utm_medium','utm_campaign','utm_content','utm_term','gclid','fbclid','campaign'].forEach(function (k) {
      var v = qs.get(k);
      if (v && !f.querySelector('[name="' + k + '"]')) { var i = document.createElement('input'); i.type = 'hidden'; i.name = k; i.value = v; f.appendChild(i); }
    });
    function size() { if (window.parent !== window) window.parent.postMessage({ type: 'clc-lead-form-height', height: document.documentElement.scrollHeight }, '*'); }
    window.addEventListener('load', size); window.addEventListener('resize', size);
    function check(el) {
      var wrap = el.closest('.fld'); if (!wrap) return true;
      var msg = wrap.querySelector('.err'), v = (el.value || '').trim(), bad = '';
      if (el.required && !v) bad = 'This field is required.';
      else if (el.dataset.phone && v && v.replace(/\\D/g, '').replace(/^91(?=\\d{10}$)/, '').length !== 10) bad = 'Enter a 10-digit mobile number.';
      else if (el.type === 'email' && v && !/^[^@\\s]+@[^@\\s]+\\.[^@\\s]+$/.test(v)) bad = 'Enter a valid email address.';
      wrap.classList.toggle('bad', !!bad);
      if (msg) { msg.textContent = bad; msg.hidden = !bad; }
      return !bad;
    }
    f.querySelectorAll('input,select,textarea').forEach(function (el) { el.addEventListener('blur', function () { check(el); size(); }); });
    f.addEventListener('submit', function (ev) {
      ev.preventDefault(); e.textContent = '';
      var good = true;
      f.querySelectorAll('.fld input,.fld select,.fld textarea').forEach(function (el) { if (!check(el)) good = false; });
      var c = f.querySelector('.chk input[required]');
      if (c && !c.checked) { good = false; e.textContent = 'Please tick the box to agree to be contacted.'; }
      size();
      if (!good) return;
      b.disabled = true; b.textContent = 'Sending…';
      var data = {}; new FormData(f).forEach(function (v, k) { data[k] = v; });
      fetch('/public/leads/website', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(data) })
        .then(function (r) { return r.json(); })
        .then(function (res) {
          if (res && res.success) { f.hidden = true; ok.hidden = false; }
          else { e.textContent = (res && res.message) || 'Please check the form and try again.'; b.disabled = false; b.textContent = label; }
          size();
        })
        .catch(function () { e.textContent = 'Network error — please try again.'; b.disabled = false; b.textContent = label; size(); });
    });
  })();
</script>
</body>
</html>`;

  res.status(200).set('Content-Type', 'text/html; charset=utf-8').set('Cache-Control', 'public, max-age=60').send(html);
};

// GET /public/lead-form/:platform/config — the form as JSON, so a custom page
// can draw itself from the same config the hosted page uses.
const leadFormConfig = async (req, res) => {
  const platform = platformOf(req.params.platform);
  const { fields, copy } = await loadForm(platform);
  res.status(200).json({ success: true, result: { platform, endpoint: '/public/leads/website', fields, ...copy }, message: 'ok' });
};

// GET /public/lead-form/embed.js — the "Embed the form on a website" snippet:
//   <div id="clc-lead-form"></div>
//   <script src="https://…/public/lead-form/embed.js" data-source="Website" async></script>
// Puts the hosted form into that div (an iframe that grows to fit), passing
// data-source / data-campaign and the host page's own ?utm_* on, so every
// lead arrives tagged with where it came from.
const embedScript = async (req, res) => {
  const origin = `${req.protocol}://${req.get('host')}`;
  const js = `(function () {
  var s = document.currentScript || document.querySelector('script[src*="/public/lead-form/embed.js"]');
  var box = document.getElementById((s && s.getAttribute('data-target')) || 'clc-lead-form');
  if (!box) { box = document.createElement('div'); s.parentNode.insertBefore(box, s); }
  var q = new URLSearchParams(location.search), p = new URLSearchParams({ embed: '1' });
  var src = (s && s.getAttribute('data-source')) || '', camp = (s && s.getAttribute('data-campaign')) || '';
  ['utm_source','utm_medium','utm_campaign','utm_content','utm_term','gclid','fbclid'].forEach(function (k) { if (q.get(k)) p.set(k, q.get(k)); });
  if (src && !p.get('utm_source')) p.set('utm_source', src);
  if (camp && !p.get('utm_campaign')) p.set('utm_campaign', camp);
  var f = document.createElement('iframe');
  f.src = ${JSON.stringify(origin)} + '/public/lead-form/website?' + p.toString();
  f.title = 'Enquiry form'; f.loading = 'lazy';
  f.style.cssText = 'width:100%;max-width:520px;border:0;display:block;height:760px;color-scheme:light';
  box.appendChild(f);
  window.addEventListener('message', function (ev) {
    if (ev.source === f.contentWindow && ev.data && ev.data.type === 'clc-lead-form-height') f.style.height = Math.ceil(ev.data.height) + 'px';
  });
})();`;
  res.status(200).set('Content-Type', 'application/javascript; charset=utf-8').set('Cache-Control', 'public, max-age=300').send(js);
};

module.exports = { renderLeadFormPage, leadFormConfig, embedScript, DEFAULT_FIELDS, DEFAULT_OPTIONS, DEFAULT_COPY };
