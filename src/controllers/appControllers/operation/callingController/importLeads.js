const mongoose = require('mongoose');
const fs = require('fs');
const path = require('path');
const XLSX = require('xlsx');

// Phone → digits only. Accepts 8–15 digits (E.164-ish, generous for local).
const digits = (s) => String(s || '').replace(/[^\d]/g, '');
const validPhone = (s) => {
  const d = digits(s);
  return d.length >= 8 && d.length <= 15;
};

const norm = (s) => String(s).replace(/^﻿/, '').toLowerCase().replace(/[^a-z0-9]/g, '');
const field = (row, ...aliases) => {
  const by = {};
  for (const k of Object.keys(row)) by[norm(k)] = row[k];
  for (const a of aliases) {
    const v = by[norm(a)];
    if (v !== undefined && v !== null && String(v).trim() !== '') return String(v).trim();
  }
  return '';
};

const NAME_A = ['name', 'fullname', 'full name', 'clientname', 'client name', 'leadname', 'contactname', 'customer name'];
const PHONE_A = ['phone', 'phone number', 'phoneno', 'mobile', 'mobile number', 'contact', 'contactnumber', 'contact number', 'number', 'whatsapp'];
const EMAIL_A = ['email', 'email address', 'emailid', 'e-mail', 'mail'];
const COMPANY_A = ['company', 'organisation', 'organization', 'org', 'account'];
const SOURCE_A = ['source', 'leadsource', 'lead source', 'channel'];
const NOTES_A = ['notes', 'note', 'remark', 'remarks', 'comment'];

function parseRows(diskPath) {
  const ext = path.extname(diskPath).toLowerCase();
  if (ext === '.csv') {
    const content = fs.readFileSync(diskPath, 'utf8').replace(/^﻿/, '');
    const wb = XLSX.read(content, { type: 'string' });
    return XLSX.utils.sheet_to_json(wb.Sheets[wb.SheetNames[0]], { defval: '' });
  }
  const wb = XLSX.readFile(diskPath);
  return XLSX.utils.sheet_to_json(wb.Sheets[wb.SheetNames[0]], { defval: '' });
}

// POST /api/calling/campaigns/:id/leads/import   (multipart: file=<csv|xlsx>)
const importLeads = async (req, res) => {
  const CallCampaign = mongoose.model('CallCampaign');
  const CallLead = mongoose.model('CallLead');

  const camp = await CallCampaign.findOne({ _id: req.params.id, removed: false });
  if (!camp) return res.status(404).json({ success: false, result: null, message: 'Campaign not found' });
  if (!req.upload) return res.status(400).json({ success: false, result: null, message: 'No file uploaded.' });

  let rows;
  try {
    rows = parseRows(path.join('src', req.upload.filePath));
  } catch (e) {
    return res.status(400).json({
      success: false,
      result: null,
      message: 'Could not read the file. Use a .csv or .xlsx with a header row (name, phone, email, company, source, notes).',
    });
  }

  const batch = `imp-${Date.now()}`;
  const existing = new Set(
    (await CallLead.find({ campaign: camp._id, removed: false }).select('phoneNormalized').lean()).map(
      (l) => l.phoneNormalized
    )
  );

  const docs = [];
  const errors = [];
  let dupes = 0;
  rows.forEach((row, i) => {
    const name = field(row, ...NAME_A);
    const phoneRaw = field(row, ...PHONE_A);
    if (!name) return errors.push(`Row ${i + 2}: missing name`);
    if (!validPhone(phoneRaw)) return errors.push(`Row ${i + 2}: invalid phone "${phoneRaw}"`);
    const pn = digits(phoneRaw);
    if (existing.has(pn)) {
      dupes++;
      return;
    }
    existing.add(pn);
    docs.push({
      campaign: camp._id,
      name,
      phone: phoneRaw,
      phoneNormalized: pn,
      email: field(row, ...EMAIL_A) || undefined,
      company: field(row, ...COMPANY_A) || undefined,
      source: field(row, ...SOURCE_A) || 'Import',
      notes: field(row, ...NOTES_A) || undefined,
      status: 'New',
      importBatch: batch,
    });
  });

  let inserted = 0;
  for (let i = 0; i < docs.length; i += 500) {
    try {
      const r = await CallLead.insertMany(docs.slice(i, i + 500), { ordered: false });
      inserted += r.length;
    } catch (err) {
      if (Array.isArray(err.insertedDocs)) inserted += err.insertedDocs.length;
    }
  }

  await getRecountedCampaign(camp._id);

  return res.status(200).json({
    success: true,
    result: { inserted, duplicates: dupes, invalid: errors.length, errors: errors.slice(0, 50), batch },
    message: `Imported ${inserted} leads (${dupes} duplicates skipped, ${errors.length} invalid).`,
  });
};

// POST /api/calling/campaigns/:id/leads   { name, phone, email, company, source, notes }
const createLead = async (req, res) => {
  const CallCampaign = mongoose.model('CallCampaign');
  const CallLead = mongoose.model('CallLead');
  const camp = await CallCampaign.findOne({ _id: req.params.id, removed: false });
  if (!camp) return res.status(404).json({ success: false, result: null, message: 'Campaign not found' });

  const b = req.body || {};
  if (!b.name || !String(b.name).trim())
    return res.status(400).json({ success: false, result: null, message: 'Name is required.' });
  if (!validPhone(b.phone))
    return res.status(400).json({ success: false, result: null, message: 'Enter a valid phone number (8–15 digits).' });

  const pn = digits(b.phone);
  const dup = await CallLead.findOne({ campaign: camp._id, phoneNormalized: pn, removed: false }).lean();
  if (dup) return res.status(409).json({ success: false, result: dup, message: 'This number is already in the campaign.' });

  const saved = await new CallLead({
    campaign: camp._id,
    name: String(b.name).trim(),
    phone: String(b.phone).trim(),
    phoneNormalized: pn,
    email: b.email || undefined,
    company: b.company || undefined,
    source: b.source || 'Manual',
    notes: b.notes || undefined,
    status: 'New',
  }).save();

  await getRecountedCampaign(camp._id);
  return res.status(200).json({ success: true, result: saved, message: 'Lead added' });
};

// GET /api/calling/campaigns/:id/leads?status=&q=&page=&items=
const listLeads = async (req, res) => {
  const CallLead = mongoose.model('CallLead');
  const page = parseInt(req.query.page) || 1;
  const items = Math.min(parseInt(req.query.items) || 25, 200);
  const filter = { campaign: req.params.id, removed: false };
  if (req.query.status && req.query.status !== 'All') filter.status = req.query.status;
  if (req.query.q) {
    const rx = new RegExp(String(req.query.q).replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i');
    filter.$or = [{ name: rx }, { phone: rx }, { email: rx }, { company: rx }];
  }
  const [result, count] = await Promise.all([
    CallLead.find(filter).sort({ created: -1 }).skip((page - 1) * items).limit(items).lean(),
    CallLead.countDocuments(filter),
  ]);
  return res.status(200).json({
    success: true,
    result,
    pagination: { page, pages: Math.ceil(count / items) || 0, count },
    message: 'ok',
  });
};

async function getRecountedCampaign(id) {
  const CallLead = mongoose.model('CallLead');
  const total = await CallLead.countDocuments({ campaign: id, removed: false });
  const pending = await CallLead.countDocuments({ campaign: id, removed: false, status: { $in: ['New', 'Queued'] } });
  await mongoose
    .model('CallCampaign')
    .updateOne({ _id: id }, { $set: { 'stats.totalLeads': total, 'stats.pending': pending, 'stats.dialed': total - pending } });
}

module.exports = { importLeads, createLead, listLeads };
