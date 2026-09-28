const mongoose = require('mongoose');
const { BY_CODE } = require('../../../../services/calling/dispositions');
const { getProvider } = require('../../../../services/calling');
const { last10 } = require('../../../../services/calling/callingShared');

// "Call this lead" from a lead row / the agent screen.
//
//  • CALLING_PROVIDER=cloud  → Plivo rings the customer first; once they
//    answer, Plivo hits our answer_url which bridges to the owning agent —
//    a real, recorded, server-placed call. Returns { record, bridged:true }.
//  • otherwise                → device tel: link: the call runs on the
//    agent's own phone / softphone; the CRM just tracks it (contact, timing,
//    disposition, notes, callback). Returns { record, tel:'tel:…' }.

const digits = (s) => String(s || '').replace(/[^\d+]/g, '');
const validPhone = (s) => {
  const d = digits(s).replace(/\+/g, '');
  return d.length >= 8 && d.length <= 15;
};
const secs = (from, to) => Math.max(0, Math.round((to - from) / 1000));

// POST /api/calling/manual/dial  { phone, contactName?, campaign?, callLead? }
const dial = async (req, res) => {
  const CallRecord = mongoose.model('CallRecord');
  const b = req.body || {};
  if (!validPhone(b.phone)) {
    return res.status(400).json({ success: false, result: null, message: 'Enter a valid phone number.' });
  }

  let contactName = b.contactName;
  let campaign = b.campaign || undefined;
  if (b.callLead) {
    const lead = await mongoose.model('CallLead').findById(b.callLead).lean();
    if (lead) {
      contactName = contactName || lead.name;
      campaign = campaign || lead.campaign;
      await mongoose.model('CallLead').updateOne(
        { _id: lead._id },
        { $set: { status: 'Dialing', lastAttemptAt: new Date(), assignedAgent: req.admin._id }, $inc: { attempts: 1 } }
      );
    }
  }

  // Cloud provider (Plivo): place a real call — the provider rings the
  // customer first, then bridges to the owning agent once they answer.
  const provider = getProvider();
  if (provider.name === 'cloud' && typeof provider.placeCall === 'function') {
    const r = await provider.placeCall({
      agent: req.admin,
      agentPhone: b.agentPhone || undefined, // per-call override / first-time set
      phone: String(b.phone).trim(),
      contactName: contactName || 'Manual Call',
      callLead: b.callLead || undefined,
      campaign,
    });
    // Remember the agent's number for next time if they supplied one (used
    // for CDR agent-attribution matching, not to place this call).
    if (r.ok && b.agentPhone && !req.admin.phone) {
      await mongoose.model('Admin').updateOne({ _id: req.admin._id }, { $set: { phone: String(b.agentPhone).trim() } });
    }
    if (!r.ok) {
      return res.status(502).json({ success: false, result: null, message: r.error || 'Provider could not place the call.' });
    }
    return res.status(200).json({
      success: true,
      result: { record: r.callRecord, bridged: true },
      message: 'Calling the customer now — they\'ll be connected once they pick up.',
    });
  }

  const now = new Date();
  const rec = await new CallRecord({
    campaign,
    callLead: b.callLead || undefined,
    agent: req.admin._id,
    agentName: `${req.admin.name} ${req.admin.surname || ''}`.trim(),
    contactName: contactName || 'Manual Call',
    phone: String(b.phone).trim(),
    direction: 'Outbound',
    status: 'connected', // device call — CRM can't observe real ring state
    phaseAt: now,
    queuedAt: now,
    answeredAt: now,
    provider: 'manual',
    isMock: false,
    providerCallId: `manual-${now.getTime()}`,
  }).save();

  return res.status(200).json({
    success: true,
    result: { record: rec, tel: `tel:${digits(b.phone)}` },
    message: 'Opening your phone dialer — the call runs on your device.',
  });
};

// POST /api/calling/manual/end/:id  { disposition?, notes?, talkSeconds? }
const end = async (req, res) => {
  const CallRecord = mongoose.model('CallRecord');
  const rec = await CallRecord.findOne({ _id: req.params.id, removed: false });
  if (!rec) return res.status(404).json({ success: false, result: null, message: 'Call not found' });
  if (String(rec.agent) !== String(req.admin._id) && req.callingTier === 'agent') {
    return res.status(403).json({ success: false, result: null, message: 'Not your call.' });
  }

  const now = new Date();
  rec.status = 'completed';
  rec.endedAt = now;
  rec.phaseAt = now;
  const provided = Number(req.body.talkSeconds);
  rec.duration = Number.isFinite(provided) && provided >= 0 ? Math.round(provided) : secs(rec.answeredAt || now, now);
  if (req.body.disposition) rec.disposition = req.body.disposition;
  if (req.body.notes != null) rec.notes = req.body.notes;
  // Device calls are not recorded by the CRM.
  rec.recording = { status: 'unavailable', url: null, durationSec: 0 };
  await rec.save();

  if (rec.callLead) {
    const d = req.body.disposition && BY_CODE[req.body.disposition];
    let status = 'Completed';
    if (d) {
      if (d.category === 'callback') status = 'Callback';
      else if (d.category === 'dnc') status = 'DNC';
    }
    await mongoose.model('CallLead').updateOne(
      { _id: rec.callLead },
      { $set: { status, lastDisposition: req.body.disposition || undefined } }
    );
  } else {
    // No CallLead behind this one — it's a raw "call this lead" dial from
    // the Dialer screen's Contacts queue (frontend/src/pages/Calling/
    // Dialer.jsx), which passes only phone/contactName. That flow already
    // moves the Lead's own stage (Contacted/No Response) straight from the
    // frontend, but never records that a real call actually happened —
    // stamp that here so "Used Leads" (leadController/usedLeads.js) can
    // tell a genuinely-dialled lead apart from one whose stage just
    // happened to be set some other way.
    const phoneNorm = last10(rec.phone);
    if (phoneNorm) {
      const d = req.body.disposition && BY_CODE[req.body.disposition];
      const outcome = d ? d.label : rec.duration > 0 ? 'Connected' : 'No Answer';
      await mongoose.model('Lead').updateOne(
        { phoneNormalized: phoneNorm, removed: false },
        { $push: { callHistory: { outcome, byName: rec.agentName || undefined, at: new Date() } } }
      );
    }
  }

  return res.status(200).json({ success: true, result: rec, message: 'Call logged' });
};

module.exports = { dial, end };
