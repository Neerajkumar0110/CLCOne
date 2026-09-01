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

// Looks up a column by any of the given aliases (each normalised the same
// way as the row's headers). Returns '' when nothing matches or the cell
// is blank.
const field = (row, ...aliases) => {
  const byKey = {};
  for (const k of Object.keys(row)) byKey[norm(k)] = row[k];
  for (const alias of aliases) {
    const v = byKey[norm(alias)];
    if (v !== undefined && v !== null && String(v).trim() !== '') return String(v).trim();
  }
  return '';
};

const NAME_ALIASES = [
  'name', 'fullname', 'full name', 'clientname', 'client name', 'leadname', 'lead name',
  'customername', 'contactname', 'candidatename', 'studentname', 'applicantname', 'personname',
];
const PHONE_ALIASES = [
  'phone', 'phonenumber', 'phone number', 'phoneno', 'mobile', 'mobilenumber', 'mobile number',
  'mobileno', 'contact', 'contactnumber', 'contact number', 'contactno', 'whatsapp',
  'whatsappnumber', 'number', 'primaryphone', 'cell', 'cellphone', 'telephone', 'tel',
];
const EMAIL_ALIASES = ['email', 'emailaddress', 'email address', 'emailid', 'email id', 'mail', 'e-mail'];
const SOURCE_ALIASES = ['source', 'leadsource', 'lead source', 'utmsource', 'channel'];
const STATUS_ALIASES = ['status', 'leadstatus', 'lead status', 'stage', 'leadstage', 'lead stage'];
const SUBSTATUS_ALIASES = ['substatus', 'sub status', 'sub-status', 'substage', 'sub stage', 'leadsubstatus'];
const POSITION_ALIASES = [
  'position', 'designation', 'role', 'jobtitle', 'job title', 'title', 'course', 'interest',
  'interestedin', 'program', 'department',
];
const ALT_PHONE_ALIASES = [
  'alternatecontactnumber', 'alternate contact number', 'alternatephone', 'alternate phone',
  'alternatecontact', 'altphone', 'alt phone', 'secondaryphone', 'secondary phone',
  'alternatenumber', 'alternate number', 'phone2',
];
const CITY_ALIASES = ['city', 'town'];
const STATE_ALIASES = ['state', 'province', 'region'];
const COUNTRY_ALIASES = ['country', 'nation'];
const ZIP_ALIASES = ['zipcode', 'zip', 'zip code', 'pincode', 'pin code', 'pin', 'postalcode', 'postal code', 'postcode'];

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
  const created = [];

  const batch = await new LeadImportBatch({
    fileName: req.upload.fileName,
    team: distribution.length > 0 ? distribution.map((d) => d.team).join(', ') : team,
    teams: distribution,
    totalRows: rows.length,
    importedBy: req.admin ? `${req.admin.name} ${req.admin.surname || ''}`.trim() : undefined,
  }).save();

  // Build every valid doc up front, then bulk-insert in chunks — a
  // per-row `await save()` loop takes minutes (and times out on
  // serverless) for a file with thousands of rows.
  const docs = [];
  for (let i = 0; i < rows.length; i++) {
    const row = rows[i];
    let name = field(row, ...NAME_ALIASES);
    if (!name) {
      // Fall back to a "First Name" + "Last Name" pair if there's no single
      // name column.
      const first = field(row, 'firstname', 'first name', 'fname', 'givenname');
      const last = field(row, 'lastname', 'last name', 'lname', 'surname', 'familyname');
      name = [first, last].filter(Boolean).join(' ').trim();
    }
    if (!name) {
      errors.push(`Row ${i + 2}: missing name`);
      continue;
    }
    const rowTeam = rowTeams ? rowTeams[i] || '' : team;
    const pipeline = normalizeImported(
      field(row, ...STATUS_ALIASES),
      field(row, ...SUBSTATUS_ALIASES)
    );
    docs.push({
      name,
      phone: field(row, ...PHONE_ALIASES),
      email: field(row, ...EMAIL_ALIASES) || undefined,
      source: field(row, ...SOURCE_ALIASES) || 'Import',
      position: field(row, ...POSITION_ALIASES),
      stage: pipeline.stage,
      subStatus: pipeline.subStatus,
      status: pipeline.status,
      stageUpdatedAt: new Date(),
      alternatePhone: field(row, ...ALT_PHONE_ALIASES) || undefined,
      city: field(row, ...CITY_ALIASES) || undefined,
      state: field(row, ...STATE_ALIASES) || undefined,
      country: field(row, ...COUNTRY_ALIASES) || undefined,
      zipcode: field(row, ...ZIP_ALIASES) || undefined,
      team: rowTeam,
      color: AVATAR_COLORS[Math.floor(Math.random() * AVATAR_COLORS.length)],
      importBatch: batch._id,
    });
  }

  const CHUNK = 500;
  for (let i = 0; i < docs.length; i += CHUNK) {
    const slice = docs.slice(i, i + CHUNK);
    try {
      // ordered:false → a bad row doesn't abort the rest of the chunk.
      const inserted = await Lead.insertMany(slice, { ordered: false });
      created.push(...inserted);
    } catch (err) {
      if (err && Array.isArray(err.insertedDocs)) created.push(...err.insertedDocs);
      const writeErrors = (err && err.writeErrors) || [];
      writeErrors.forEach((we) => {
        errors.push(`Row ~${i + (we.index || 0) + 2}: ${we.errmsg || we.err?.errmsg || 'insert failed'}`);
      });
      if (writeErrors.length === 0) errors.push(`Rows ${i + 2}-${i + slice.length + 1}: ${err.message}`);
    }
  }

  batch.successCount = created.length;
  batch.failedCount = rows.length - created.length;
  batch.rowErrors = errors.slice(0, 50);
  await batch.save();

  return res.status(200).json({
    success: true,
    // Only a sample of the created docs — a big import can produce
    // thousands, and the client just needs the batch summary + message.
    result: { batch, leads: created.slice(0, 100) },
    message: `Imported ${created.length} of ${rows.length} leads.`,
  });
};

module.exports = importLeads;
