const mongoose = require('mongoose');
const { getProvider } = require('../../../../services/calling');

// Tata Business Click-to-Call SUPPORT API — dials the customer directly (no
// agent leg) and connects to whatever destination is configured on the Tata
// side (agent queue or voice bot). Multi-DID: pass `callerId` to use a
// non-default DID; omit it to use the account default.

const digits = (s) => String(s || '').replace(/[^\d+]/g, '');
const validPhone = (s) => {
  const d = digits(s).replace(/\+/g, '');
  return d.length >= 8 && d.length <= 15;
};

// POST /api/calling/support/dial  { phone, contactName?, campaign?, callLead?, callerId? }
const dial = async (req, res) => {
  const b = req.body || {};
  if (!validPhone(b.phone)) {
    return res.status(400).json({ success: false, result: null, message: 'Enter a valid phone number.' });
  }

  const provider = getProvider();
  if (provider.name !== 'cloud' || typeof provider.placeSupportCall !== 'function') {
    return res.status(400).json({
      success: false,
      result: null,
      message: 'Support click-to-call needs CALLING_PROVIDER=cloud.',
    });
  }

  let contactName = b.contactName;
  let campaign = b.campaign || undefined;
  if (b.callLead) {
    const lead = await mongoose.model('CallLead').findById(b.callLead).lean();
    if (lead) {
      contactName = contactName || lead.name;
      campaign = campaign || lead.campaign;
    }
  }

  const r = await provider.placeSupportCall({
    phone: String(b.phone).trim(),
    callerId: b.callerId || undefined,
    contactName: contactName || 'Support Call',
    callLead: b.callLead || undefined,
    campaign,
  });

  if (!r.ok) {
    const status = r.code === 'invalid_caller_id' ? 400 : 502;
    return res.status(status).json({ success: false, result: null, message: r.error || 'Provider could not place the call.' });
  }

  return res.status(200).json({
    success: true,
    result: { record: r.callRecord },
    message: 'Support call placed.',
  });
};

module.exports = { dial };
