const mongoose = require('mongoose');

const AVATAR_COLORS = ['#2563EB', '#722ED1', '#13C2C2', '#FA8C16', '#EB2F96', '#52C41A'];

// Which query/body keys carry campaign attribution.
const ATTR_KEYS = ['utm_source', 'utm_medium', 'utm_campaign', 'utm_content', 'utm_term', 'gclid', 'fbclid'];

const clean = (v) => (v == null ? '' : String(v).trim());

// POST /public/leads/website — the endpoint the hosted landing page AND the
// embeddable website form post to. Unauthenticated by necessity: it's called
// by anonymous site visitors, not a logged-in admin. Rate-limited in
// corePublicRouter.js.
//
// Accepts whatever fields the Capture Form config defines (name / email /
// phone / whatsapp / city / state / country / course / budget / howSoon /
// message) plus UTM attribution params, and a hidden honeypot field
// (`company_website`) that real users never see — if it's filled, the
// submission is a bot and is silently accepted-but-dropped.
const submitWebsiteLead = async (req, res) => {
  const Lead = mongoose.model('Lead');

  const b = req.body || {};

  // Honeypot — bots fill every field; humans can't see this one.
  if (clean(b.company_website)) {
    return res.status(200).json({ success: true, result: { id: null }, message: "Thanks! We'll be in touch shortly." });
  }

  const name = clean(b.name || b.fullname || b.full_name);
  const phoneNumber = clean(b.phone || b.whatsapp || b.mobile);

  if (!name || !phoneNumber) {
    return res.status(400).json({
      success: false,
      result: null,
      message: 'name and phone (or whatsapp) are required.',
    });
  }

  // Attribution — accept from body (hidden inputs) or, as a fallback, the
  // Referer's query string when the page forgot to forward them.
  const attrSrc = { ...b };
  try {
    const ref = req.get('referer') || req.get('referrer');
    if (ref) {
      const u = new URL(ref);
      for (const k of ATTR_KEYS) if (!attrSrc[k] && u.searchParams.get(k)) attrSrc[k] = u.searchParams.get(k);
    }
  } catch {
    /* bad referer header — ignore */
  }

  const attribution = {
    utmSource: clean(attrSrc.utm_source) || undefined,
    utmMedium: clean(attrSrc.utm_medium) || undefined,
    utmCampaign: clean(attrSrc.utm_campaign || attrSrc.campaign) || undefined,
    utmContent: clean(attrSrc.utm_content) || undefined,
    utmTerm: clean(attrSrc.utm_term) || undefined,
    gclid: clean(attrSrc.gclid) || undefined,
    fbclid: clean(attrSrc.fbclid) || undefined,
    landingPage: clean(b.landing_page || b.landingPage) || undefined,
    referrer: clean(b.referrer) || (req.get('referer') || undefined),
  };

  // `source` precedence: explicit form value → utm_source → platform hint
  // (?platform=Facebook Ads) → gclid/fbclid presence → "Website".
  const platformHint = clean(b.platform);
  let source = clean(b.source) || attribution.utmSource || platformHint;
  if (!source) {
    if (attribution.gclid) source = 'Google Ads';
    else if (attribution.fbclid) source = 'Facebook Ads';
    else source = 'Website';
  }

  const lead = await new Lead({
    name,
    phone: phoneNumber,
    email: clean(b.email) || undefined,
    source,
    // Leave stage/subStatus to the schema defaults ('New Lead' /
    // 'Newly Generated'); the pre('save') hook derives `status` from them.
    position: clean(b.course || b.interest || b.program || b.position) || undefined,
    city: clean(b.city) || undefined,
    state: clean(b.state) || undefined,
    country: clean(b.country) || undefined,
    budgetRange: clean(b.budget || b.budgetRange) || undefined,
    howSoonToStart: clean(b.howSoon || b.howSoonToStart) || undefined,
    message: clean(b.message) || undefined,
    attribution,
    color: AVATAR_COLORS[Math.floor(Math.random() * AVATAR_COLORS.length)],
  }).save();

  return res.status(200).json({
    success: true,
    result: { id: lead._id },
    message: "Thanks! We'll be in touch shortly.",
  });
};

module.exports = { submitWebsiteLead };
