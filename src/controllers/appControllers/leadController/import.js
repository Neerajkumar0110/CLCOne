const mongoose = require('mongoose');
const fs = require('fs');
const path = require('path');
const XLSX = require('xlsx');
const { normalizeImported } = require('../../../config/leadStages');

const AVATAR_COLORS = ['#2563EB', '#722ED1', '#13C2C2', '#FA8C16', '#EB2F96', '#52C41A'];

function parseRows(diskPath) {
  const ext = path.extname(diskPath).toLowerCase();
  if (ext === '.csv') {
    // utf8 read + strip a leading BOM so the first header isn't "﻿Name".
    const content = fs.readFileSync(diskPath, 'utf8').replace(/^﻿/, '');
    const workbook = XLSX.read(content, { type: 'string' });
    const sheet = workbook.Sheets[workbook.SheetNames[0]];
    return XLSX.utils.sheet_to_json(sheet, { defval: '' });
  }
  const workbook = XLSX.readFile(diskPath);
  const sheet = workbook.Sheets[workbook.SheetNames[0]];
  return XLSX.utils.sheet_to_json(sheet, { defval: '' });
}

// Normalise a header/alias down to bare lowercase alphanumerics so
// "Contact Number", "contact_number", "CONTACTNUMBER" and "Contact No."
// all collapse to the same key — makes column matching forgiving of
// whatever casing/spacing/punctuation the uploaded file happens to use.
const norm = (s) => String(s).replace(/^﻿/, '').toLowerCase().replace(/[^a-z0-9]/g, '');

// Column aliases per logical field. Pre-normalised ONCE at module load so the
// per-row lookup is plain object access — no regex work per row (a big file
// otherwise runs norm() tens of millions of times).
const K = (arr) => arr.map(norm);
const NAME_KEYS = K([
  'name', 'fullname', 'full name', 'clientname', 'client name', 'leadname', 'lead name',
  'customername', 'contactname', 'candidatename', 'studentname', 'applicantname', 'personname',
]);
const FIRST_KEYS = K(['firstname', 'first name', 'fname', 'givenname']);
const LAST_KEYS = K(['lastname', 'last name', 'lname', 'surname', 'familyname']);
const PHONE_KEYS = K([
  'phone', 'phonenumber', 'phone number', 'phoneno', 'mobile', 'mobilenumber', 'mobile number',
  'mobileno', 'contact', 'contactnumber', 'contact number', 'contactno', 'whatsapp',
  'whatsappnumber', 'number', 'primaryphone', 'cell', 'cellphone', 'telephone', 'tel',
]);
const EMAIL_KEYS = K(['email', 'emailaddress', 'email address', 'emailid', 'email id', 'mail', 'e-mail']);
const SOURCE_KEYS = K(['source', 'leadsource', 'lead source', 'utmsource', 'channel']);
const STATUS_KEYS = K(['status', 'leadstatus', 'lead status', 'stage', 'leadstage', 'lead stage']);
const SUBSTATUS_KEYS = K(['substatus', 'sub status', 'sub-status', 'substage', 'sub stage', 'leadsubstatus']);
const POSITION_KEYS = K([
  'position', 'designation', 'role', 'jobtitle', 'job title', 'title', 'course', 'interest',
  'interestedin', 'program', 'department',
]);
const ALT_PHONE_KEYS = K([
  'alternatecontactnumber', 'alternate contact number', 'alternatephone', 'alternate phone',
  'alternatecontact', 'altphone', 'alt phone', 'secondaryphone', 'secondary phone',
  'alternatenumber', 'alternate number', 'phone2',
]);
const CITY_KEYS = K(['city', 'town']);
const STATE_KEYS = K(['state', 'province', 'region']);
const COUNTRY_KEYS = K(['country', 'nation']);
const ZIP_KEYS = K(['zipcode', 'zip', 'zip code', 'pincode', 'pin code', 'pin', 'postalcode', 'postal code', 'postcode']);

// Build a resolver bound to this file's header row: normalised-header -> the
// actual key in each row object. Returned getter does zero regex per call.
function makeGetter(sampleRow) {
  const normToActual = Object.create(null);
  for (const actual of Object.keys(sampleRow || {})) {
    const n = norm(actual);
    if (!(n in normToActual)) normToActual[n] = actual;
  }
  return (row, keys) => {
    for (const k of keys) {
      const actual = normToActual[k];
      if (actual === undefined) continue;
      const v = row[actual];
      if (v !== undefined && v !== null && String(v).trim() !== '') return String(v).trim();
    }
    return '';
  };
}

const digits = (s) => String(s || '').replace(/\D/g, '');
const last10 = (s) => {
  const d = digits(s);
  return d.length > 10 ? d.slice(-10) : d;
};

// POST /api/lead/import (multipart: file=<csv|xlsx>, team=<optional single target team>,
// distribution=<optional JSON [{team,count}, ...] to manually split rows across teams>)
// Bulk-creates Leads from a spreadsheet and records one LeadImportBatch summary
// row (powers "Recent Import History"). Column headers are matched loosely
// (case / spacing / punctuation insensitive) against a wide alias list, so
// files exported from other tools ("Lead Name", "Contact Number", "Lead
// Status", …) import without needing to be renamed first.
//
// When `distribution` is provided, rows are handed out to teams in the order
// given (first `count` rows to the first team, next `count` to the second,
// etc.); any rows beyond the allocated total are imported unassigned rather
// than rejected, so a slightly-off manual split never fails the whole import.
const importLeads = async (req, res) => {
  const Lead = mongoose.model('Lead');
  const LeadImportBatch = mongoose.model('LeadImportBatch');

  if (!req.upload) {
    return res.status(400).json({ success: false, result: null, message: 'No file uploaded.' });
  }

  const team = req.body.team || '';

  let distribution = [];
  if (req.body.distribution) {
    try {
      const parsed = JSON.parse(req.body.distribution);
      if (Array.isArray(parsed)) {
        distribution = parsed
          .filter((d) => d && d.team && Number(d.count) > 0)
          .map((d) => ({ team: String(d.team), count: Number(d.count) }));
      }
    } catch (err) {
      // ignore malformed distribution, fall back to single `team`
    }
  }

  let rowTeams = null;
  if (distribution.length > 0) {
    rowTeams = [];
    distribution.forEach((d) => {
      for (let i = 0; i < d.count; i++) rowTeams.push(d.team);
    });
  }

  const diskPath = path.join('src', req.upload.filePath);

  let rows = [];
  try {
    rows = parseRows(diskPath);
  } catch (err) {
    return res.status(400).json({
      success: false,
      result: null,
      message:
        'Could not read the uploaded file. Use a .csv or .xlsx file with a header row (e.g. name, phone, email, source, status).',
    });
  }

  const errors = [];
  const duplicates = [];
  const createdSample = [];
  let createdCount = 0;

  const get = makeGetter(rows[0]);

  // Dedupe key for a lead: its phone's last 10 digits (so "+91 70170 55778",
  // "07017055778" and "7017055778" all match), else name+email lowercased.
  // Rows with neither can't be matched and are always imported.
  const dedupeKey = (name, phone, email) => {
    const p = last10(phone);
    if (p.length >= 7) return `p:${p}`;
    if (email) return `n:${String(name).trim().toLowerCase()}|${String(email).trim().toLowerCase()}`;
    return null;
  };

  // ── pass 1: parse rows into candidate docs, collect dedupe keys ──────────
  const candidates = []; // { doc, key }
  const phoneSet = new Set(); // last10 phone keys seen in the file
  const emailSet = new Set(); // lowercased emails for phone-less rows

  for (let i = 0; i < rows.length; i++) {
    const row = rows[i];
    let name = get(row, NAME_KEYS);
    if (!name) {
      const first = get(row, FIRST_KEYS);
      const last = get(row, LAST_KEYS);
      name = [first, last].filter(Boolean).join(' ').trim();
    }
    if (!name) {
      errors.push(`Row ${i + 2}: missing name`);
      continue;
    }

    const rowPhone = get(row, PHONE_KEYS);
    const rowEmail = get(row, EMAIL_KEYS);
    const key = dedupeKey(name, rowPhone, rowEmail);

    const p = last10(rowPhone);
    if (p.length >= 7) phoneSet.add(p);
    else if (rowEmail) emailSet.add(rowEmail.trim().toLowerCase());

    const rowTeam = rowTeams ? rowTeams[i] || '' : team;
    const pipeline = normalizeImported(get(row, STATUS_KEYS), get(row, SUBSTATUS_KEYS));

    candidates.push({
      key,
      row: i + 2,
      doc: {
        name,
        phone: rowPhone,
        email: rowEmail || undefined,
        source: get(row, SOURCE_KEYS) || 'Import',
        position: get(row, POSITION_KEYS),
        stage: pipeline.stage,
        subStatus: pipeline.subStatus,
        status: pipeline.status,
        stageUpdatedAt: new Date(),
        alternatePhone: get(row, ALT_PHONE_KEYS) || undefined,
        city: get(row, CITY_KEYS) || undefined,
        state: get(row, STATE_KEYS) || undefined,
        country: get(row, COUNTRY_KEYS) || undefined,
        zipcode: get(row, ZIP_KEYS) || undefined,
        team: rowTeam,
        color: AVATAR_COLORS[Math.floor(Math.random() * AVATAR_COLORS.length)],
      },
    });
  }

  // ── existing-lead lookup: bounded by the file, NOT the whole collection ──
  // (was: load every lead into memory — O(all leads); now O(rows in file)).
  const existingKeys = new Set();
  const or = [];
  if (phoneSet.size) or.push({ phoneNormalized: { $in: [...phoneSet] } });
  if (emailSet.size) {
    // match either the stored case or lowercase — most rows store as given
    const emails = new Set();
    for (const e of emailSet) {
      emails.add(e);
      emails.add(e.toLowerCase());
    }
    or.push({ email: { $in: [...emails] } });
  }
  if (or.length) {
    const existing = await Lead.find({ removed: false, $or: or })
      .select('phoneNormalized email name')
      .lean();
    for (const l of existing) {
      const k = dedupeKey(l.name, l.phoneNormalized, l.email);
      if (k) existingKeys.add(k);
    }
  }

  const batch = await new LeadImportBatch({
    fileName: req.upload.fileName,
    team: distribution.length > 0 ? distribution.map((d) => d.team).join(', ') : team,
    teams: distribution,
    totalRows: rows.length,
    importedBy: req.admin ? `${req.admin.name} ${req.admin.surname || ''}`.trim() : undefined,
  }).save();

  // ── pass 2: drop dupes, keep the rest ──────────────────────────────────
  const seenInFile = new Set();
  const docs = [];
  for (const c of candidates) {
    if (c.key) {
      if (existingKeys.has(c.key)) {
        duplicates.push({ name: c.doc.name, phone: c.doc.phone, email: c.doc.email, reason: 'already in CRM', row: c.row });
        continue;
      }
      if (seenInFile.has(c.key)) {
        duplicates.push({ name: c.doc.name, phone: c.doc.phone, email: c.doc.email, reason: 'repeated in file', row: c.row });
        continue;
      }
      seenInFile.add(c.key);
    }
    c.doc.importBatch = batch._id;
    docs.push(c.doc);
  }

  // ── bulk insert in chunks — never a per-row save() loop ─────────────────
  const CHUNK = 1000;
  for (let i = 0; i < docs.length; i += CHUNK) {
    const slice = docs.slice(i, i + CHUNK);
    try {
      // ordered:false → a bad row doesn't abort the rest of the chunk.
      // Only a small sample of inserted docs is kept — a big import can
      // produce hundreds of thousands and the client just needs the summary.
      const inserted = await Lead.insertMany(slice, { ordered: false });
      createdCount += inserted.length;
      for (const d of inserted) {
        if (createdSample.length < 100) createdSample.push(d);
      }
    } catch (err) {
      const insErr = (err && err.insertedDocs) || [];
      createdCount += insErr.length;
      for (const d of insErr) if (createdSample.length < 100) createdSample.push(d);
      const writeErrors = (err && err.writeErrors) || [];
      writeErrors.forEach((we) => {
        errors.push(`Row ~${i + (we.index || 0) + 2}: ${we.errmsg || we.err?.errmsg || 'insert failed'}`);
      });
      if (writeErrors.length === 0) errors.push(`Rows ${i + 2}-${i + slice.length + 1}: ${err.message}`);
    }
  }

  batch.successCount = createdCount;
  batch.duplicateCount = duplicates.length;
  batch.duplicates = duplicates.slice(0, 1000);
  batch.failedCount = rows.length - createdCount - duplicates.length;
  batch.rowErrors = errors.slice(0, 50);
  await batch.save();

  const dupMsg = duplicates.length ? ` ${duplicates.length} duplicate${duplicates.length === 1 ? '' : 's'} skipped.` : '';
  return res.status(200).json({
    success: true,
    result: { batch, leads: createdSample, duplicates: duplicates.slice(0, 200) },
    message: `Imported ${createdCount} of ${rows.length} leads.${dupMsg}`,
  });
};

module.exports = importLeads;
