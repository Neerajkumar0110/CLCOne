const mongoose = require('mongoose');

// Default field set when no CaptureFormConfig has been saved yet, so the
// hosted page is never blank.
const FALLBACK_FIELDS = [
  { key: 'name', label: 'Full Name', type: 'Text', enabled: true, required: true },
  { key: 'email', label: 'Email Address', type: 'Email', enabled: true },
  { key: 'phone', label: 'Phone / WhatsApp', type: 'Text', enabled: true, required: true },
  { key: 'course', label: 'Course / Interest', type: 'Text', enabled: true },
  { key: 'city', label: 'City', type: 'Text', enabled: true },
];

const esc = (s) =>
  String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

const DROPDOWN_OPTS = {
  source: ['Facebook', 'Instagram', 'Google Search', 'LinkedIn', 'YouTube', 'Referral', 'Other'],
  budget: ['Under ₹10,000', '₹10,000 – ₹25,000', '₹25,000 – ₹50,000', '₹50,000+'],
  howSoon: ['Immediate', 'Within 1 Week', 'Within 15 Days', 'Within 30 Days', 'Just exploring'],
};

function fieldControl(f) {
  const req = f.required || f.key === 'name' ? 'required' : '';
  if (f.type === 'Textarea') {
    return `<textarea name="${esc(f.key)}" rows="3" placeholder="${esc(f.label)}" ${req}></textarea>`;
  }
  if (f.type === 'Dropdown') {
    const opts = (DROPDOWN_OPTS[f.key] || [])
      .map((o) => `<option value="${esc(o)}">${esc(o)}</option>`)
      .join('');
    return `<select name="${esc(f.key)}" ${req}><option value="">${esc(f.label)}</option>${opts}</select>`;
  }
  const type =
    f.type === 'Email' ? 'email' : f.key === 'phone' || f.type === 'WhatsApp' ? 'tel' : 'text';
  return `<input type="${type}" name="${esc(f.key)}" placeholder="${esc(f.label)}" ${req} />`;
}

// GET /public/lead-form/:platform?  — a self-contained, mobile-first landing
// page built from the saved CaptureFormConfig. This is the URL you point a
// Facebook / Google / Instagram / LinkedIn ad at: leads submit here and land
// straight in the CRM, tagged with the campaign from the page's ?utm_* query.
// No ad-platform OAuth required.
const renderLeadFormPage = async (req, res) => {
  const CaptureFormConfig = mongoose.model('CaptureFormConfig');
  const platform = req.params.platform === 'facebook' ? 'Facebook Ads' : 'Website';

  let fields = FALLBACK_FIELDS;
  try {
    const cfg = await CaptureFormConfig.findOne({ platform, removed: false }).lean();
    const on = (cfg?.fields || []).filter((f) => f.enabled);
    if (on.length) fields = on;
  } catch {
    /* fall back to FALLBACK_FIELDS */
  }

  const q = req.query || {};
  const attrKeys = ['utm_source', 'utm_medium', 'utm_campaign', 'utm_content', 'utm_term', 'gclid', 'fbclid', 'campaign', 'source', 'platform'];
  const hidden = attrKeys
    .filter((k) => q[k])
    .map((k) => `<input type="hidden" name="${k}" value="${esc(q[k])}" />`)
    .join('\n      ');

  const heading = esc(q.headline || 'Get in touch with us');
  const sub = esc(q.subtext || "Fill this form and our team will reach out within 24 hours.");
  const brand = esc(q.brand || 'Career Lab Consulting');
  const endpoint = '/public/leads/website';

  const controls = fields
    .map(
      (f) => `<label class="fld">
        <span>${esc(f.label)}${f.required || f.key === 'name' ? ' *' : ''}</span>
        ${fieldControl(f)}
      </label>`
    )
    .join('\n      ');

  const html = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<meta name="robots" content="noindex" />
<title>${heading} — ${brand}</title>
<style>
  *{box-sizing:border-box}
  body{margin:0;font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,Helvetica,Arial,sans-serif;background:#0f172a;color:#0f172a;
    min-height:100vh;display:flex;align-items:center;justify-content:center;padding:20px}
  .card{width:100%;max-width:460px;background:#fff;border-radius:18px;box-shadow:0 24px 60px rgba(2,6,23,.45);overflow:hidden}
  .hd{background:linear-gradient(135deg,#2563eb,#7c3aed);color:#fff;padding:26px 26px 22px}
  .hd h1{margin:0 0 6px;font-size:20px;font-weight:800}
  .hd p{margin:0;font-size:13px;opacity:.9;line-height:1.5}
  form{padding:22px 26px 26px;display:flex;flex-direction:column;gap:14px}
  .fld{display:flex;flex-direction:column;gap:5px}
  .fld span{font-size:12px;font-weight:700;color:#475569}
  input,select,textarea{font:inherit;font-size:14px;padding:11px 12px;border:1px solid #cbd5e1;border-radius:10px;width:100%;background:#fff;color:#0f172a}
  input:focus,select:focus,textarea:focus{outline:none;border-color:#2563eb;box-shadow:0 0 0 3px rgba(37,99,235,.15)}
  .hp{position:absolute;left:-9999px;width:1px;height:1px;overflow:hidden}
  button{margin-top:4px;padding:13px;border:0;border-radius:10px;background:#2563eb;color:#fff;font-size:15px;font-weight:700;cursor:pointer}
  button:disabled{opacity:.6;cursor:progress}
  .ok{padding:40px 26px;text-align:center}
  .ok .ic{width:56px;height:56px;border-radius:50%;background:#dcfce7;color:#16a34a;display:flex;align-items:center;justify-content:center;
    font-size:30px;margin:0 auto 14px}
  .ok h2{margin:0 0 6px;font-size:18px}
  .ok p{margin:0;color:#64748b;font-size:13.5px}
  .ft{padding:0 26px 20px;font-size:11px;color:#94a3b8;text-align:center}
  .err{color:#dc2626;font-size:12.5px;font-weight:600;min-height:16px}
</style>
</head>
<body>
  <div class="card">
    <div class="hd">
      <h1>${heading}</h1>
      <p>${sub}</p>
    </div>
    <form id="f">
      <div class="hp"><label>Company Website<input type="text" name="company_website" tabindex="-1" autocomplete="off" /></label></div>
      ${hidden}
      <input type="hidden" name="landing_page" value="" />
      ${controls}
      <div class="err" id="e"></div>
      <button type="submit" id="b">Submit</button>
    </form>
    <div class="ok" id="ok" style="display:none">
      <div class="ic">&#10003;</div>
      <h2>Thank you!</h2>
      <p>Our team will contact you shortly.</p>
    </div>
    <div class="ft">Powered by ${brand}</div>
  </div>
<script>
  (function () {
    var f = document.getElementById('f'), ok = document.getElementById('ok'),
        b = document.getElementById('b'), e = document.getElementById('e');
    var lp = f.querySelector('input[name=landing_page]'); if (lp) lp.value = location.href;
    // Forward any UTM params that are on THIS url but weren't server-rendered.
    ['utm_source','utm_medium','utm_campaign','utm_content','utm_term','gclid','fbclid','campaign','source'].forEach(function (k) {
      var v = new URLSearchParams(location.search).get(k);
      if (v && !f.querySelector('[name="' + k + '"]')) {
        var i = document.createElement('input'); i.type = 'hidden'; i.name = k; i.value = v; f.appendChild(i);
      }
    });
    f.addEventListener('submit', function (ev) {
      ev.preventDefault(); e.textContent = ''; b.disabled = true; b.textContent = 'Submitting…';
      var data = {}; new FormData(f).forEach(function (v, k) { data[k] = v; });
      fetch('${endpoint}', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(data) })
        .then(function (r) { return r.json(); })
        .then(function (res) {
          if (res && res.success) { f.style.display = 'none'; ok.style.display = 'block'; }
          else { e.textContent = (res && res.message) || 'Please check the form and try again.'; b.disabled = false; b.textContent = 'Submit'; }
        })
        .catch(function () { e.textContent = 'Network error — please try again.'; b.disabled = false; b.textContent = 'Submit'; });
    });
  })();
</script>
</body>
</html>`;

  res.status(200).set('Content-Type', 'text/html; charset=utf-8').set('Cache-Control', 'public, max-age=120').send(html);
};

// GET /public/lead-form/:platform/config — JSON of the enabled fields, so an
// external / custom-built page can render itself from the same config the
// hosted page uses and stay in sync.
const leadFormConfig = async (req, res) => {
  const CaptureFormConfig = mongoose.model('CaptureFormConfig');
  const platform = req.params.platform === 'facebook' ? 'Facebook Ads' : 'Website';
  let fields = FALLBACK_FIELDS;
  try {
    const cfg = await CaptureFormConfig.findOne({ platform, removed: false }).lean();
    const on = (cfg?.fields || []).filter((f) => f.enabled);
    if (on.length) fields = on;
  } catch {
    /* fall back */
  }
  res.status(200).json({
    success: true,
    result: { platform, endpoint: '/public/leads/website', fields },
    message: 'ok',
  });
};

module.exports = { renderLeadFormPage, leadFormConfig };
