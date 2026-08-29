const mongoose = require('mongoose');

const AVATAR_COLORS = ['#2563EB', '#722ED1', '#13C2C2', '#FA8C16', '#EB2F96', '#52C41A'];

// POST /public/leads/website — the endpoint the embeddable website form
// (generated from the Capture Form tab) actually posts to. Unauthenticated
// by necessity: it's called by anonymous site visitors, not a logged-in
// admin. Rate-limited in corePublicRouter.js.
const submitWebsiteLead = async (req, res) => {
  const Lead = mongoose.model('Lead');

  const { name, email, whatsapp, phone, source, budget, howSoon, message } = req.body || {};
  const phoneNumber = phone || whatsapp;

  if (!name || !String(name).trim() || !phoneNumber || !String(phoneNumber).trim()) {
    return res.status(400).json({
      success: false,
      result: null,
      message: 'name and phone (or whatsapp) are required.',
    });
  }

  const lead = await new Lead({
    name: String(name).trim(),
    phone: String(phoneNumber).trim(),
    email: email ? String(email).trim() : undefined,
    source: 'Website',
    status: 'New',
    budgetRange: budget,
    howSoonToStart: howSoon,
    message,
    color: AVATAR_COLORS[Math.floor(Math.random() * AVATAR_COLORS.length)],
  }).save();

  return res.status(200).json({
    success: true,
    result: { id: lead._id },
    message: "Thanks! We'll be in touch shortly.",
  });
};

module.exports = { submitWebsiteLead };
