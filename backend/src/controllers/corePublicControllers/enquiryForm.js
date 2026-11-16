const crypto = require('crypto');
const mongoose = require('mongoose');
const LOGO = require('./enquiryLogo');

// Detailed enquiry form (user ask 2026-11-16: "ek best form do jisme customer
// ka sab aa sake — name, email, no, education, kaha se hai, kya karta hai").
//
// GET  /public/enquiry               — the page (self-contained, mobile-first, 3 steps)
// POST /public/leads/enquiry         — its submit
//
// Every answer lands in the lead's EXISTING profile fields — the same ones the
// agent fills on a call (persona, education, highestQualification, college,
// profile, currentCtc, painPoint, programInterest, preferredLanguage, …) — so
// the agent sees the whole person before dialing. Same phone already in the
// CRM → that lead is updated (empty fields filled), never duplicated.
// A link sent from the Ad chat inbox carries ?c=<signed lead id>, so the
// answers join THAT chat's lead even when WhatsApp hid the customer's number.

const esc = (s) =>
  String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const clean = (v, max = 300) => (v == null ? '' : String(v).trim().slice(0, max));

// ── chat-link token: "<leadId>.<hmac>" ─────────────────────────────────────
function sign(id) {
  return crypto.createHmac('sha256', process.env.JWT_SECRET || 'enquiry').update(`enquiry:${id}`).digest('base64url').slice(0, 16);
}
function chatToken(leadId) {
  return `${leadId}.${sign(String(leadId))}`;
}
function leadIdFromToken(t) {
  const [id, mac] = String(t || '').split('.');
  if (!id || !mac || !mongoose.isValidObjectId(id)) return null;
  const want = sign(id);
  if (mac.length !== want.length || !crypto.timingSafeEqual(Buffer.from(mac), Buffer.from(want))) return null;
  return id;
}

// ── options (kept in step with frontend config/leadPersonas.js) ────────────
const STATUS = [
  { v: 'student', label: 'Student / Fresher', hint: 'In college or recently graduated', persona: 'Student / Fresher', icon: '🎓' },
  { v: 'working', label: 'Working Professional', hint: 'Doing a job right now', persona: 'Working Professional', icon: '💼' },
  { v: 'restart', label: 'Homemaker / Career Restart', hint: 'Coming back after a break', persona: 'Homemaker / Career Restart', icon: '🏡' },
  { v: 'business', label: 'Business / Freelancer', hint: 'Own work or freelancing', persona: 'Business / Freelancer', icon: '🚀' },
];
const GOALS = [
  { v: 'Job into AI', label: 'Get a job in AI / Data' },
  { v: 'Upgradation for High CTC', label: 'Higher salary / better role' },
  { v: 'Need a Opportunity for Earning', label: 'Start earning / restart career' },
  { v: 'Learn a new skill', label: 'Learn a new skill' },
  { v: 'Freelancing / Own business', label: 'Freelancing / grow my business' },
];
const PROGRAMS = ['Data Science & AI', 'Machine Learning', 'Generative AI & LLMs', 'AI Agents & Automation', 'Data Analytics', 'Python with AI', 'Digital Marketing with AI', 'Not sure — please guide me'];
const START = ['Immediately', 'Within 1 month', 'In 1–3 months', 'Just exploring'];
const CALL_TIME = ['Morning (10–1)', 'Afternoon (1–5)', 'Evening (5–8)', 'Any time'];
const LANGS = ['Hindi', 'English', 'Hinglish', 'Tamil', 'Telugu', 'Kannada', 'Malayalam', 'Bengali', 'Marathi', 'Gujarati', 'Punjabi', 'Other'];
const STATES = ['Andhra Pradesh', 'Arunachal Pradesh', 'Assam', 'Bihar', 'Chhattisgarh', 'Delhi', 'Goa', 'Gujarat', 'Haryana', 'Himachal Pradesh', 'Jammu & Kashmir', 'Jharkhand', 'Karnataka', 'Kerala', 'Ladakh', 'Madhya Pradesh', 'Maharashtra', 'Manipur', 'Meghalaya', 'Mizoram', 'Nagaland', 'Odisha', 'Puducherry', 'Punjab', 'Rajasthan', 'Sikkim', 'Tamil Nadu', 'Telangana', 'Tripura', 'Uttar Pradesh', 'Uttarakhand', 'West Bengal', 'Chandigarh', 'Andaman & Nicobar', 'Dadra & Nagar Haveli and Daman & Diu', 'Lakshadweep', 'Outside India'];
const EXPERIENCE = ['Less than 1 year', '1–3 years', '3–5 years', '5–10 years', '10+ years'];
const GAP = ['Less than 1 year', '1–3 years', '3–5 years', '5+ years'];
const YEARS = (() => {
  const y = new Date().getFullYear();
  const out = [];
  for (let i = y + 4; i >= y - 15; i -= 1) out.push(String(i));
  return out;
})();

// persona matrix → age band + education wording the CRM uses
function derive(b) {
  const tech = b.stream === 'tech' || b.workType === 'tech' || b.qualification === 'Tech Graduate';
  const out = { techBackground: b.stream || b.workType || b.qualification ? (tech ? 'Technical' : 'Non-technical') : undefined };
  if (b.status === 'student') {
    out.persona = 'Student / Fresher';
    out.age = '18-25';
    out.education = `${b.stream === 'tech' ? 'Tech.' : 'Non Tech.'} ${b.studyStatus === 'graduated' ? 'Graduate' : 'College Student'}`;
    out.painPoint = 'Job into AI';
  } else if (b.status === 'working') {
    out.persona = 'Working Professional';
    out.highestQualification = b.qualification || undefined;
    out.age = b.qualification === 'Non Tech Graduate' ? '21-40' : b.qualification ? '21-35' : undefined;
    out.education = b.workType ? (b.workType === 'tech' ? 'Tech Professional' : 'Non Tech Professional') : undefined;
    out.painPoint = 'Upgradation for High CTC';
  } else if (b.status === 'restart') {
    out.persona = 'Homemaker / Career Restart';
    out.highestQualification = b.qualification || undefined;
    out.age = '24-45';
    out.education = { 'Tech Graduate': 'Technical Background', 'Non Tech Graduate': 'Non Tech Background', 'Non Graduate': 'No Background' }[b.qualification];
    out.painPoint = 'Need a Opportunity for Earning';
  } else if (b.status === 'business') {
    out.persona = 'Business / Freelancer';
  }
  if (GOALS.some((g) => g.v === b.goal)) out.painPoint = b.goal; // their own answer wins
  return out;
}

// POST /public/leads/enquiry
const submitEnquiry = async (req, res) => {
  const Lead = mongoose.model('Lead');
  const b = req.body || {};
  if (clean(b.company_website)) return res.status(200).json({ success: true, result: null, message: 'Thank you!' }); // honeypot

  const name = clean(b.name, 120);
  let phone = clean(b.phone, 20).replace(/[^\d+]/g, '');
  const digits = phone.replace(/\D/g, '');
  if (digits.length === 12 && digits.startsWith('91')) phone = digits.slice(2);
  else if (digits.length === 11 && digits.startsWith('0')) phone = digits.slice(1);
  else phone = digits;
  const email = clean(b.email, 120).toLowerCase();
  if (!name) return res.status(400).json({ success: false, message: 'Please enter your name.' });
  if (!/^[6-9]\d{9}$/.test(phone) && !(digits.length >= 10 && digits.length <= 15 && b.state === 'Outside India')) {
    return res.status(400).json({ success: false, message: 'Please enter a valid 10-digit mobile number.' });
  }
  if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(email)) return res.status(400).json({ success: false, message: 'Please check your email address.' });
  if (!STATUS.some((s) => s.v === b.status)) return res.status(400).json({ success: false, message: 'Please tell us what you do right now.' });

  const d = derive(b);
  const pick = (v, list) => (list.includes(v) ? v : undefined);
  const fields = {
    email: email || undefined,
    gender: pick(b.gender, ['Male', 'Female', 'Other']),
    city: clean(b.city, 80) || undefined,
    state: pick(b.state, STATES),
    country: b.state === 'Outside India' ? clean(b.country, 60) || 'Outside India' : 'India',
    persona: d.persona,
    age: d.age,
    highestQualification: d.highestQualification,
    education: d.education,
    techBackground: d.techBackground,
    painPoint: d.painPoint,
    college: clean(b.status === 'working' || b.status === 'business' ? b.company : b.college, 150) || undefined,
    profile: clean(b.status === 'student' ? b.degree : b.status === 'working' || b.status === 'business' ? b.role : '', 120) || undefined,
    currentCtc: (b.status === 'working' && clean(b.ctc, 60)) || undefined,
    programInterest: pick(b.program, PROGRAMS),
    howSoonToStart: pick(b.start, START),
    preferredLanguage: pick(b.language, LANGS),
    consent: b.consent ? `Agreed to calls / WhatsApp / email — enquiry form ${new Date().toISOString().slice(0, 10)}` : undefined,
  };
  // everything else the agent should read, in one block
  const extra = [
    b.status === 'student' && clean(b.degree) && `Course: ${clean(b.degree, 120)}${clean(b.year) ? ` (${clean(b.year, 4)})` : ''}`,
    b.status === 'student' && clean(b.college) && `College: ${clean(b.college, 150)}`,
    (b.status === 'working' || b.status === 'business') && clean(b.role) && `Role: ${clean(b.role, 120)}${clean(b.company) ? ` at ${clean(b.company, 150)}` : ''}`,
    b.status === 'working' && pick(b.experience, EXPERIENCE) && `Experience: ${b.experience}`,
    b.status === 'restart' && pick(b.gap, GAP) && `Career break: ${b.gap}`,
    pick(b.callTime, CALL_TIME) && `Best time to call: ${b.callTime}`,
    clean(b.message, 1000) && `Question: ${clean(b.message, 1000)}`,
  ].filter(Boolean);
  const summary = `[Enquiry form ${new Date().toLocaleDateString('en-IN', { timeZone: 'Asia/Kolkata' })}] ${extra.join(' · ')}`.slice(0, 1800);

  // which lead: the chat this link was sent in → same phone → new
  let lead = null;
  const fromChat = leadIdFromToken(b.c);
  if (fromChat) lead = await Lead.findOne({ _id: fromChat, removed: false }).exec();
  const phoneKey = Lead.normalizePhone ? Lead.normalizePhone(phone) : phone;
  if (!lead) lead = await Lead.findOne({ removed: false, phoneNormalized: phoneKey }).exec();

  if (lead) {
    // their own answers fill what the CRM doesn't know yet — an agent's entry is never overwritten
    for (const [k, v] of Object.entries(fields)) if (v && !lead[k]) lead[k] = v;
    if (!lead.phone) lead.phone = phone;
    if (/^(Messenger|Instagram|WhatsApp) user$/i.test(lead.name || '') || !lead.name) lead.name = name;
    lead.message = [summary, lead.message].filter(Boolean).join('\n').slice(0, 4000);
    lead.enquiryAt = new Date();
    await lead.save();
  } else {
    const ATTR = ['utm_source', 'utm_medium', 'utm_campaign', 'utm_content', 'utm_term', 'gclid', 'fbclid'];
    const at = {};
    ATTR.forEach((k) => {
      if (clean(b[k])) at[k.replace(/_(\w)/g, (_, c) => c.toUpperCase())] = clean(b[k], 120);
    });
    lead = await new Lead({
      name,
      phone,
      ...Object.fromEntries(Object.entries(fields).filter(([, v]) => v)),
      source: clean(b.utm_source, 60) || clean(b.source, 60) || 'Enquiry Form',
      message: summary,
      enquiryAt: new Date(),
      attribution: { ...at, landingPage: clean(b.landing_page, 300) || undefined, referrer: req.get('referer') || undefined },
    }).save();
  }

  try {
    require('../../socket').emitLeadEvent('lead:chat', { kind: 'updated', id: String(lead._id), name: lead.name, channel: lead.chatChannel, hasPhone: !!lead.phone, text: 'Filled the enquiry form', at: new Date() });
  } catch (_) {
    /* no socket in scripts */
  }
  return res.status(200).json({ success: true, result: { id: lead._id }, message: 'Thank you!' });
};

// ── the page ───────────────────────────────────────────────────────────────
const opts = (list, ph) => `<option value="">${esc(ph)}</option>${list.map((o) => `<option>${esc(o)}</option>`).join('')}`;
const chips = (name, list, { required } = {}) =>
  `<div class="chips" role="radiogroup">${list
    .map((o, i) => {
      const v = typeof o === 'string' ? o : o.v;
      const label = typeof o === 'string' ? o : o.label;
      return `<label class="chip"><input type="radio" name="${name}" value="${esc(v)}" ${required && i === 0 ? 'required' : ''}/><span>${esc(label)}</span></label>`;
    })
    .join('')}</div>`;

const renderEnquiryPage = async (req, res) => {
  const q = req.query || {};
  const hidden = ['utm_source', 'utm_medium', 'utm_campaign', 'utm_content', 'utm_term', 'gclid', 'fbclid', 'source', 'c']
    .filter((k) => q[k])
    .map((k) => `<input type="hidden" name="${k}" value="${esc(String(q[k]).slice(0, 200))}" />`)
    .join('');
  // prefill (e.g. the chat already knows the name / number)
  let pre = {};
  const chatLead = leadIdFromToken(q.c);
  if (chatLead) {
    const l = await mongoose.model('Lead').findById(chatLead).select('name phone email city').lean().catch(() => null);
    if (l) pre = { name: /^(Messenger|Instagram|WhatsApp) user$/i.test(l.name || '') ? '' : l.name, phone: l.phone, email: l.email, city: l.city };
  }
  const v = (k) => (pre[k] ? ` value="${esc(pre[k])}"` : '');

  const html = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover" />
<meta name="robots" content="noindex" />
<meta name="theme-color" content="#4338ca" />
<title>Career Counselling Form — Career Lab Consulting</title>
<link rel="preconnect" href="https://fonts.googleapis.com" />
<link href="https://fonts.googleapis.com/css2?family=Plus+Jakarta+Sans:wght@400;500;600;700;800&family=Cinzel:wght@600;700&display=swap" rel="stylesheet" />
<link rel="icon" type="image/png" href="${LOGO}" />
<style>
  :root{--ink:#0f172a;--muted:#64748b;--line:#e2e8f0;--soft:#f8fafc;--brand:#4338ca;--brand2:#7c3aed;--ok:#16a34a;--err:#dc2626}
  *{box-sizing:border-box}
  html,body{margin:0}
  body{font-family:"Plus Jakarta Sans",-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,Arial,sans-serif;color:var(--ink);
    background:radial-gradient(1200px 600px at 10% -10%,#c7d2fe 0,transparent 60%),radial-gradient(900px 500px at 110% 10%,#e9d5ff 0,transparent 55%),#f1f5f9;
    min-height:100vh;padding:24px 16px 40px}
  .wrap{max-width:620px;margin:0 auto}
  .brand{display:flex;align-items:center;gap:12px;margin-bottom:18px;text-decoration:none}
  .brand img{width:46px;height:46px;flex:none;filter:drop-shadow(0 2px 4px rgba(15,23,42,.18))}
  .brand span{display:flex;flex-direction:column;font-family:Cinzel,"Times New Roman",Georgia,serif;font-weight:700;color:#111827;line-height:1.05;letter-spacing:.06em}
  .brand span b{font-size:19px;font-weight:700}
  .brand span small{font-size:12.5px;letter-spacing:.32em;font-weight:600;color:#374151}
  .card{background:#fff;border-radius:22px;box-shadow:0 1px 2px rgba(15,23,42,.06),0 24px 60px -20px rgba(67,56,202,.28);overflow:hidden}
  .hero{padding:26px 26px 18px;background:linear-gradient(135deg,#4338ca,#7c3aed 60%,#db2777);color:#fff;position:relative}
  .hero h1{margin:0 0 6px;font-size:23px;line-height:1.25;font-weight:800;letter-spacing:-.01em}
  .hero p{margin:0;font-size:14px;opacity:.92;line-height:1.55}
  .perks{display:flex;gap:8px;flex-wrap:wrap;margin-top:14px}
  .perks span{font-size:12px;font-weight:600;background:rgba(255,255,255,.16);border:1px solid rgba(255,255,255,.25);padding:5px 10px;border-radius:999px}
  .steps{display:flex;gap:6px;padding:16px 26px 0}
  .steps div{flex:1;height:6px;border-radius:999px;background:var(--line);overflow:hidden}
  .steps div b{display:block;height:100%;width:0;background:linear-gradient(90deg,var(--brand),var(--brand2));transition:width .35s ease}
  .steps div.done b,.steps div.on b{width:100%}
  .stepname{padding:10px 26px 0;font-size:12px;font-weight:700;color:var(--muted);letter-spacing:.04em;text-transform:uppercase}
  form{padding:6px 26px 26px}
  section{display:none;animation:in .3s ease}
  section.on{display:block}
  @keyframes in{from{opacity:0;transform:translateY(6px)}to{opacity:1;transform:none}}
  h2{font-size:19px;margin:6px 0 4px;font-weight:800}
  .sub{margin:0 0 16px;color:var(--muted);font-size:13.5px}
  .grid{display:grid;grid-template-columns:1fr 1fr;gap:14px}
  .full{grid-column:1/-1}
  label.f{display:flex;flex-direction:column;gap:6px}
  label.f>span,.q{font-size:13px;font-weight:700;color:#334155}
  .q{display:block;margin:4px 0 8px}
  .req{color:var(--err)}
  input[type=text],input[type=tel],input[type=email],select,textarea{font:inherit;font-size:15px;padding:12px 14px;border:1.5px solid var(--line);border-radius:12px;width:100%;background:#fff;color:var(--ink);transition:border-color .15s,box-shadow .15s}
  textarea{resize:vertical;min-height:84px}
  input:focus,select:focus,textarea:focus{outline:none;border-color:var(--brand);box-shadow:0 0 0 4px rgba(67,56,202,.12)}
  .tel{display:flex;align-items:stretch;border:1.5px solid var(--line);border-radius:12px;overflow:hidden;transition:border-color .15s,box-shadow .15s}
  .tel:focus-within{border-color:var(--brand);box-shadow:0 0 0 4px rgba(67,56,202,.12)}
  .tel b{display:flex;align-items:center;padding:0 12px;background:var(--soft);color:var(--muted);font-weight:700;font-size:14px;border-right:1.5px solid var(--line)}
  .tel input{border:0!important;box-shadow:none!important;border-radius:0}
  .cards{display:grid;grid-template-columns:1fr 1fr;gap:10px;margin-bottom:6px}
  .card-opt{position:relative;cursor:pointer}
  .card-opt input{position:absolute;opacity:0;pointer-events:none}
  .card-opt span{display:flex;flex-direction:column;gap:3px;padding:14px;border:1.5px solid var(--line);border-radius:14px;height:100%;transition:all .15s}
  .card-opt span em{font-style:normal;font-size:22px}
  .card-opt span b{font-size:14px}
  .card-opt span small{font-size:12px;color:var(--muted)}
  .card-opt:hover span{border-color:#c7d2fe}
  .card-opt input:checked+span{border-color:var(--brand);background:#eef2ff;box-shadow:0 0 0 3px rgba(67,56,202,.1)}
  .card-opt input:focus-visible+span{outline:2px solid var(--brand);outline-offset:2px}
  .chips{display:flex;flex-wrap:wrap;gap:8px}
  .chip{cursor:pointer}
  .chip input{position:absolute;opacity:0;pointer-events:none}
  .chip span{display:inline-block;padding:9px 14px;border:1.5px solid var(--line);border-radius:999px;font-size:13.5px;font-weight:600;color:#334155;transition:all .15s}
  .chip:hover span{border-color:#c7d2fe}
  .chip input:checked+span{background:var(--brand);border-color:var(--brand);color:#fff}
  .chip input:focus-visible+span{outline:2px solid var(--brand);outline-offset:2px}
  .block{margin-top:16px}
  .cond{display:none}
  .cond.on{display:block;animation:in .25s ease}
  .consent{display:flex;gap:10px;align-items:flex-start;margin-top:18px;font-size:12.5px;color:var(--muted);line-height:1.5;cursor:pointer}
  .consent input{margin-top:2px;width:18px;height:18px;accent-color:var(--brand);flex:none}
  .nav{display:flex;gap:10px;margin-top:22px}
  .btn{flex:1;padding:14px 18px;border:0;border-radius:12px;font:inherit;font-size:15px;font-weight:700;cursor:pointer;transition:transform .1s,opacity .15s}
  .btn:active{transform:scale(.99)}
  .btn.pri{background:linear-gradient(135deg,var(--brand),var(--brand2));color:#fff;box-shadow:0 10px 24px -10px rgba(67,56,202,.7)}
  .btn.sec{flex:0 0 auto;background:var(--soft);color:#334155;border:1.5px solid var(--line)}
  .btn:disabled{opacity:.6;cursor:progress}
  .err{color:var(--err);font-size:13px;font-weight:600;min-height:18px;margin-top:12px}
  .bad{border-color:var(--err)!important}
  .hp{position:absolute;left:-9999px;width:1px;height:1px;overflow:hidden}
  .done{display:none;padding:40px 26px 34px;text-align:center}
  .done .ic{width:74px;height:74px;border-radius:50%;margin:0 auto 16px;background:#dcfce7;color:var(--ok);display:flex;align-items:center;justify-content:center;font-size:38px;animation:pop .4s ease}
  @keyframes pop{0%{transform:scale(.4);opacity:0}70%{transform:scale(1.08)}100%{transform:scale(1);opacity:1}}
  .done h2{font-size:22px}
  .done p{color:var(--muted);font-size:14.5px;line-height:1.6;margin:6px auto 0;max-width:380px}
  .trust{display:flex;justify-content:center;gap:16px;flex-wrap:wrap;margin-top:16px;font-size:12px;color:var(--muted)}
  .foot{text-align:center;font-size:11.5px;color:#94a3b8;margin-top:16px}
  @media (max-width:520px){.grid,.cards{grid-template-columns:1fr}.hero h1{font-size:20px}form,.hero,.steps,.stepname{padding-left:18px;padding-right:18px}body{padding:14px 10px 30px}}
</style>
</head>
<body>
<div class="wrap">
  <div class="brand"><img src="${LOGO}" alt="Career Lab Consulting" width="46" height="46" /><span><b>CAREER LAB</b><small>CONSULTING</small></span></div>
  <div class="card">
    <div class="hero">
      <h1>Free career counselling — tell us about you</h1>
      <p>2 minutes. Our counsellor reads this before calling, so the advice fits <b>you</b> — your education, your work and your goal.</p>
      <div class="perks"><span>✓ Free 1:1 call</span><span>✓ Right course for you</span><span>✓ No spam</span></div>
    </div>
    <div class="steps" aria-hidden="true"><div class="on"><b></b></div><div><b></b></div><div><b></b></div></div>
    <div class="stepname" id="sn">Step 1 of 3 · About you</div>

    <form id="f" novalidate>
      <div class="hp"><label>Company website<input type="text" name="company_website" tabindex="-1" autocomplete="off" /></label></div>
      ${hidden}
      <input type="hidden" name="landing_page" value="" />

      <!-- STEP 1 -->
      <section class="on" data-step="1" data-name="About you">
        <h2>Let&rsquo;s start with you</h2>
        <p class="sub">So we know who to call and where.</p>
        <div class="grid">
          <label class="f full"><span>Full name <b class="req">*</b></span><input type="text" name="name" autocomplete="name" placeholder="e.g. Priya Sharma" required${v('name')} /></label>
          <label class="f"><span>Mobile (WhatsApp) <b class="req">*</b></span>
            <div class="tel"><b>+91</b><input type="tel" name="phone" inputmode="numeric" autocomplete="tel-national" maxlength="14" placeholder="98765 43210" required${v('phone')} /></div></label>
          <label class="f"><span>Email</span><input type="email" name="email" autocomplete="email" placeholder="you@example.com"${v('email')} /></label>
          <label class="f"><span>City <b class="req">*</b></span><input type="text" name="city" autocomplete="address-level2" placeholder="e.g. Lucknow" required${v('city')} /></label>
          <label class="f"><span>State <b class="req">*</b></span><select name="state" required>${opts(STATES, 'Select state')}</select></label>
        </div>
        <div class="block"><span class="q">Gender</span>${chips('gender', ['Male', 'Female', 'Other'])}</div>
      </section>

      <!-- STEP 2 -->
      <section data-step="2" data-name="Education & work">
        <h2>What do you do right now? <b class="req">*</b></h2>
        <p class="sub">Pick the one closest to you.</p>
        <div class="cards" role="radiogroup">
          ${STATUS.map((s) => `<label class="card-opt"><input type="radio" name="status" value="${s.v}" required /><span><em>${s.icon}</em><b>${esc(s.label)}</b><small>${esc(s.hint)}</small></span></label>`).join('')}
        </div>

        <div class="cond" data-when="student">
          <div class="block"><span class="q">Are you studying or have you graduated? <b class="req">*</b></span>${chips('studyStatus', [{ v: 'studying', label: 'Still studying' }, { v: 'graduated', label: 'Graduated' }])}</div>
          <div class="block"><span class="q">Your stream <b class="req">*</b></span>${chips('stream', [{ v: 'tech', label: 'Technical (B.Tech, BCA, B.Sc CS/IT, MCA…)' }, { v: 'nontech', label: 'Non-technical (B.Com, BA, BBA, B.Sc…)' }])}</div>
          <div class="grid block">
            <label class="f"><span>Course / degree</span><input type="text" name="degree" placeholder="e.g. B.Tech CSE" /></label>
            <label class="f"><span>Passing year</span><select name="year">${opts(YEARS, 'Select year')}</select></label>
            <label class="f full"><span>College / university</span><input type="text" name="college" placeholder="e.g. AKTU, Lucknow" /></label>
          </div>
        </div>

        <div class="cond" data-when="working">
          <div class="block"><span class="q">Your highest qualification <b class="req">*</b></span>${chips('qualification', [{ v: 'Tech Graduate', label: 'Technical graduate' }, { v: 'Non Tech Graduate', label: 'Non-technical graduate' }])}</div>
          <div class="block"><span class="q">Your work is mostly… <b class="req">*</b></span>${chips('workType', [{ v: 'tech', label: 'Technical (IT, software, data…)' }, { v: 'nontech', label: 'Non-technical (sales, ops, finance…)' }])}</div>
          <div class="grid block">
            <label class="f"><span>Job role</span><input type="text" name="role" placeholder="e.g. Sales Executive" /></label>
            <label class="f"><span>Company</span><input type="text" name="company" placeholder="e.g. HDFC Bank" /></label>
            <label class="f"><span>Experience</span><select name="experience">${opts(EXPERIENCE, 'Select')}</select></label>
            <label class="f"><span>Current salary (CTC / month)</span><input type="text" name="ctc" placeholder="e.g. 4.5 LPA or ₹30,000/month" /></label>
          </div>
        </div>

        <div class="cond" data-when="restart">
          <div class="block"><span class="q">Your highest qualification <b class="req">*</b></span>${chips('qualification', [{ v: 'Tech Graduate', label: 'Technical graduate' }, { v: 'Non Tech Graduate', label: 'Non-technical graduate' }, { v: 'Non Graduate', label: 'Not a graduate' }])}</div>
          <div class="block"><span class="q">How long is your career break?</span>${chips('gap', GAP)}</div>
        </div>

        <div class="cond" data-when="business">
          <div class="grid block">
            <label class="f"><span>What do you do?</span><input type="text" name="role" placeholder="e.g. Freelance designer, shop owner" /></label>
            <label class="f"><span>Business / brand name</span><input type="text" name="company" placeholder="Optional" /></label>
          </div>
          <div class="block"><span class="q">Your highest qualification</span>${chips('qualification', [{ v: 'Tech Graduate', label: 'Technical graduate' }, { v: 'Non Tech Graduate', label: 'Non-technical graduate' }, { v: 'Non Graduate', label: 'Not a graduate' }])}</div>
        </div>
      </section>

      <!-- STEP 3 -->
      <section data-step="3" data-name="Your goal">
        <h2>What do you want to achieve?</h2>
        <p class="sub">This helps the counsellor suggest the right path.</p>
        <div class="block" style="margin-top:0"><span class="q">Your main goal <b class="req">*</b></span>${chips('goal', GOALS)}</div>
        <div class="grid block">
          <label class="f"><span>Interested in</span><select name="program">${opts(PROGRAMS, 'Choose a program')}</select></label>
          <label class="f"><span>When can you start?</span><select name="start">${opts(START, 'Select')}</select></label>
          <label class="f"><span>Language for the call</span><select name="language">${opts(LANGS, 'Select')}</select></label>
          <label class="f"><span>Best time to call</span><select name="callTime">${opts(CALL_TIME, 'Select')}</select></label>
          <label class="f full"><span>Anything you want to ask?</span><textarea name="message" maxlength="1000" placeholder="e.g. I am from a commerce background — can I learn Data Science?"></textarea></label>
        </div>
        <label class="consent"><input type="checkbox" name="consent" value="1" checked /> I agree that Career Lab Consulting may contact me by call, WhatsApp or email about my enquiry.</label>
      </section>

      <div class="err" id="e" role="alert"></div>
      <div class="nav">
        <button type="button" class="btn sec" id="back" style="display:none">Back</button>
        <button type="button" class="btn pri" id="next">Continue →</button>
      </div>
    </form>

    <div class="done" id="ok">
      <div class="ic">✓</div>
      <h2>Thank you<span id="okname"></span>!</h2>
      <p>We&rsquo;ve got your details. A counsellor will call you on <b id="okphone"></b> soon — keep your phone handy.</p>
      <div class="trust"><span>🔒 Your details stay private</span><span>📞 Free counselling</span></div>
    </div>
  </div>
  <div class="foot">© Career Lab Consulting</div>
</div>
<script>
(function(){
  var f=document.getElementById('f'),secs=[].slice.call(f.querySelectorAll('section')),bars=[].slice.call(document.querySelectorAll('.steps div')),
      next=document.getElementById('next'),back=document.getElementById('back'),e=document.getElementById('e'),sn=document.getElementById('sn'),step=0;
  var lp=f.querySelector('[name=landing_page]'); if(lp) lp.value=location.href;
  // only the inputs of the visible part of a step count
  function live(sec){return [].slice.call(sec.querySelectorAll('input,select,textarea')).filter(function(i){var c=i.closest('.cond');return !c||c.classList.contains('on')})}
  function status(){var s=f.querySelector('[name=status]:checked');return s?s.value:''}
  function cond(){var s=status();[].forEach.call(f.querySelectorAll('.cond'),function(c){var on=c.getAttribute('data-when')===s;c.classList.toggle('on',on);
    [].forEach.call(c.querySelectorAll('input,select,textarea'),function(i){i.disabled=!on})})}
  f.addEventListener('change',function(ev){if(ev.target.name==='status')cond();ev.target.classList&&ev.target.classList.remove('bad');e.textContent=''});
  cond();
  function req(sec){
    var bad=null,msg='';
    var radios={};
    var all=live(sec);
    all.forEach(function(i){
      if(i.type==='radio'){var g=i.name;if(radios[g])return;radios[g]=1;var box=i.closest('.block,.cards');
        var star=box&&(box.classList.contains('cards')||box.querySelector('.req'));
        if(star&&!all.some(function(x){return x.name===g&&x.checked})){bad=bad||i;msg=msg||'Please choose an option.'}return}
      i.classList.remove('bad');
      var v=(i.value||'').trim();
      if(i.required&&!v){i.classList.add('bad');bad=bad||i;msg=msg||'Please fill the required fields.'}
      if(v&&i.name==='phone'){var d=v.replace(/\\D/g,'');if(d.length===12&&d.indexOf('91')===0)d=d.slice(2);if(d.length===11&&d[0]==='0')d=d.slice(1);
        if(!/^[6-9]\\d{9}$/.test(d)&&f.state.value!=='Outside India'){i.closest('.tel').classList.add('bad');bad=bad||i;msg=msg||'Please enter a valid 10-digit mobile number.'}else i.closest('.tel').classList.remove('bad')}
      if(v&&i.type==='email'&&!/^[^\\s@]+@[^\\s@]+\\.[^\\s@]{2,}$/.test(v)){i.classList.add('bad');bad=bad||i;msg=msg||'Please check your email address.'}
    });
    if(bad){e.textContent=msg;try{bad.focus({preventScroll:false})}catch(_){}}
    return !bad;
  }
  function show(n){step=n;secs.forEach(function(s,i){s.classList.toggle('on',i===n)});bars.forEach(function(b,i){b.className=i<n?'done':i===n?'on':''});
    sn.textContent='Step '+(n+1)+' of 3 · '+secs[n].getAttribute('data-name');back.style.display=n?'':'none';next.textContent=n===2?'Get my free counselling':'Continue →';e.textContent='';
    window.scrollTo({top:0,behavior:'smooth'})}
  back.onclick=function(){if(step)show(step-1)};
  next.onclick=function(){
    if(!req(secs[step]))return;
    if(step<2)return show(step+1);
    var data={};new FormData(f).forEach(function(v,k){data[k]=v});
    next.disabled=true;next.textContent='Sending…';
    fetch('/public/leads/enquiry',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(data)})
      .then(function(r){return r.json()}).then(function(r){
        if(r&&r.success){f.style.display='none';document.querySelector('.steps').style.display='none';sn.style.display='none';
          document.getElementById('okname').textContent=data.name?', '+data.name.split(' ')[0]:'';document.getElementById('okphone').textContent=data.phone||'your number';
          document.getElementById('ok').style.display='block';window.scrollTo({top:0,behavior:'smooth'})}
        else{e.textContent=(r&&r.message)||'Please check the form and try again.';next.disabled=false;next.textContent='Get my free counselling'}})
      .catch(function(){e.textContent='Network problem — please try again.';next.disabled=false;next.textContent='Get my free counselling'});
  };
  f.addEventListener('keydown',function(ev){if(ev.key==='Enter'&&ev.target.tagName!=='TEXTAREA'){ev.preventDefault();next.click()}});
})();
</script>
</body>
</html>`;
  res.status(200).set('Content-Type', 'text/html; charset=utf-8').set('Cache-Control', chatLead ? 'no-store' : 'public, max-age=120').send(html);
};

module.exports = { renderEnquiryPage, submitEnquiry, chatToken, leadIdFromToken, derive };
