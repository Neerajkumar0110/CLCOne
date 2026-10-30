const mongoose = require('mongoose');
const { BY_CODE } = require('../../../../services/calling/dispositions');
const { FULL_ACCESS_ROLES } = require('../../../../services/access/salesScope');

const tail = (p) => String(p || '').replace(/\D/g, '').slice(-10);

// GET /api/lead/full-detail?id=<leadId>&phone=<phone>
//
// Everything about one customer in one go, for the shared lead detail modal
// (frontend components/LeadFullDetail): the Lead with every field the users
// filled in, every call to / from that number (who, when, how long they
// talked, response, notes, recording), pending callbacks, and totals.
// Either id or phone is enough — rows that aren't CRM leads (a number only
// the dialer knows) still get their call history.
// Recordings follow the Recordings page rule: full-access roles hear every
// call, everyone else only their own.
const fullDetail = async (req, res) => {
  const Lead = mongoose.model('Lead');
  const { id, phone } = req.query;

  let lead = null;
  if (id && mongoose.isValidObjectId(id)) lead = await Lead.findOne({ _id: id, removed: false }).select('-rawMetaData').lean();
  const key = tail((lead && lead.phone) || phone);
  if (!lead && key.length === 10) lead = await Lead.findOne({ removed: false, phoneNormalized: key }).select('-rawMetaData').lean();
  if (!lead && key.length !== 10) {
    return res.status(404).json({ success: false, result: null, message: 'Lead not found.' });
  }

  const phones = [key, ...(lead && lead.alternatePhone ? [tail(lead.alternatePhone)] : [])].filter((p) => p.length === 10);
  const calls = phones.length
    ? await mongoose
        .model('CallRecord')
        .find({ removed: false, phone: { $regex: `(${phones.join('|')})$` } })
        .select(
          'agent agentName ownerAgent ownerAgentName direction status created answeredAt endedAt duration disposition notes contactName instantLead missedByAgent transferredTo recording.status recording.url'
        )
        .sort({ created: -1 })
        .limit(200)
        .lean()
    : [];

  const me = String(req.admin._id);
  const seesAll = FULL_ACCESS_ROLES.includes(req.admin.role);
  const rows = calls.map((c) => {
    const mine = String(c.agent) === me || (!c.agent && String(c.ownerAgent) === me);
    return {
      _id: c._id,
      at: c.created,
      direction: c.direction || 'Outbound',
      agentName: c.agentName || c.ownerAgentName || (c.agent ? '' : 'Auto-dialer'),
      status: c.status,
      answered: !!c.answeredAt,
      talkSeconds: c.duration || 0,
      response: c.disposition ? (BY_CODE[c.disposition] ? BY_CODE[c.disposition].label : c.disposition) : null,
      notes: c.notes || '',
      instantLead: !!c.instantLead,
      missedByAgent: !!c.missedByAgent,
      transferredTo: c.transferredTo || null,
      recordingUrl: (seesAll || mine) && c.recording && c.recording.url ? c.recording.url : null,
    };
  });

  const callbacks = phones.length
    ? await mongoose
        .model('CallCallback')
        .find({ removed: false, status: 'Pending', phone: { $regex: `(${phones.join('|')})$` } })
        .select('scheduledAt assignedAgentName notes')
        .sort({ scheduledAt: 1 })
        .lean()
    : [];

  const talked = rows.filter((r) => r.answered);
  return res.status(200).json({
    success: true,
    result: {
      lead,
      phone: (lead && lead.phone) || phone,
      calls: rows,
      callbacks,
      totals: {
        calls: rows.length,
        connected: talked.length,
        talkSeconds: rows.reduce((t, r) => t + r.talkSeconds, 0),
        firstCallAt: rows.length ? rows[rows.length - 1].at : null,
        lastCallAt: rows.length ? rows[0].at : null,
        people: [...new Set(talked.map((r) => r.agentName).filter(Boolean))],
      },
    },
    message: 'ok',
  });
};

module.exports = fullDetail;
