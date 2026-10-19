const express = require('express');
const mongoose = require('mongoose');
const demo = require('../../services/sales/demoBookings');
const { escHtml: esc } = require('../../utils/emailFormat');

// GET /api/demo/j/:token — the live-demo link from the booking email. No CRM
// login: the unguessable per-person token IS the access (Google-Meet style).
// Inside the window → straight into the BigBlueButton room; otherwise a small
// page saying when it opens (auto-refreshes) or that it's over.
const router = express.Router();

const page = (title, body, { refresh } = {}) =>
  `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">${
    refresh ? `<meta http-equiv="refresh" content="${refresh}">` : ''
  }<title>${esc(title)}</title><style>body{margin:0;font:16px/1.6 -apple-system,Segoe UI,Roboto,sans-serif;background:#f4f6fb;color:#17202c;display:flex;min-height:100vh;align-items:center;justify-content:center;padding:16px;box-sizing:border-box}.c{background:#fff;border:1px solid #e3e8ef;border-radius:16px;padding:28px 24px;max-width:460px;width:100%;text-align:center;box-shadow:0 10px 30px rgba(15,23,42,.06)}h1{font-size:21px;margin:0 0 8px}p{color:#556;margin:6px 0}.w{font-weight:700;color:#17202c}</style></head><body><div class="c">${body}<p style="margin-top:18px;font-size:13px;color:#99a">Career Lab Consulting</p></div></body></html>`;

const join = async (req, res) => {
  const token = String(req.params.token || '');
  if (token.length < 16) return res.status(404).send(page('Link not found', '<h1>Link not found</h1><p>Please check the link in your email.</p>'));
  const DemoBooking = mongoose.model('DemoBooking');
  const b = await DemoBooking.findOne({
    removed: false,
    $or: [{ 'tokens.customer': token }, { 'tokens.agent': token }, { 'tokens.leader': token }],
  });
  if (!b || b.status === 'cancelled') {
    return res.status(404).send(page('Link not valid', '<h1>This demo link is no longer valid</h1><p>Please contact your Career Lab counsellor for a new booking.</p>'));
  }
  const who = b.tokens.customer === token ? 'customer' : b.tokens.agent === token ? 'agent' : 'leader';
  const when = `<p class="w">${esc(demo.fmtDay(b.date))}<br>6:00 PM – 7:00 PM (IST)</p>`;

  const state = await demo.windowState(b.date).catch(() => 'over');
  if (state === 'early') {
    return res.send(
      page(
        'Live demo — not started yet',
        `<h1>Your live demo hasn't started yet</h1>${when}<p>This page opens the demo automatically from 5:50 PM on that day — keep it open or come back then.</p>`,
        { refresh: 60 }
      )
    );
  }
  if (state === 'over') {
    return res.send(page('Live demo has ended', `<h1>This live demo has ended</h1>${when}<p>Please contact your Career Lab counsellor to book another session.</p>`));
  }

  const name = who === 'customer' ? b.name || 'Guest' : who === 'agent' ? b.agentName || 'Career Lab' : b.teamLeaderName || 'Career Lab';
  let url;
  try {
    url = await demo.joinUrl(b.date, { role: 'viewer', name: who === 'customer' ? name : `${name} (Career Lab)` });
  } catch (e) {
    console.error('[demo] join failed:', e.message);
    return res.status(503).send(page('Please try again', '<h1>The demo room is starting</h1><p>Please refresh this page in a few seconds.</p>', { refresh: 10 }));
  }
  b.joins.push({ who, name, at: new Date() });
  await b.save();
  if (who === 'customer') await demo.markAttended(b).catch(() => {});
  return res.redirect(302, url);
};
router.get('/j/:token', (req, res, next) => join(req, res).catch(next));

module.exports = router;
