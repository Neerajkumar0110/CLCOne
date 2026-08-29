const mongoose = require('mongoose');
const fs = require('fs');
const path = require('path');
const XLSX = require('xlsx');

const AVATAR_COLORS = ['#2563EB', '#722ED1', '#13C2C2', '#FA8C16', '#EB2F96', '#52C41A'];

function parseRows(diskPath) {
  const ext = path.extname(diskPath).toLowerCase();
  if (ext === '.csv') {
    const content = fs.readFileSync(diskPath, 'utf8');
    const workbook = XLSX.read(content, { type: 'string' });
    const sheet = workbook.Sheets[workbook.SheetNames[0]];
    return XLSX.utils.sheet_to_json(sheet, { defval: '' });
  }
  const workbook = XLSX.readFile(diskPath);
  const sheet = workbook.Sheets[workbook.SheetNames[0]];
  return XLSX.utils.sheet_to_json(sheet, { defval: '' });
}

// Looks up a column by any of the given aliases, matching header names
// case-insensitively (so "Client Name", "CLIENT NAME" and "name" all hit
// the same `name` alias).
const field = (row, ...keys) => {
  const byLowerKey = {};
  for (const k of Object.keys(row)) byLowerKey[k.trim().toLowerCase()] = row[k];
  for (const k of keys) {
    const v = byLowerKey[k.toLowerCase()];
    if (v !== undefined && v !== '') return String(v).trim();
  }
  return '';
};

// POST /api/lead/import (multipart: file=<csv|xlsx>, team=<optional single target team>,
// distribution=<optional JSON [{team,count}, ...] to manually split rows across teams>)
// Bulk-creates Leads from a spreadsheet and records one LeadImportBatch summary
// row (powers "Recent Import History"). Expected columns (case-insensitive):
// name, phone, source, position, status.
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
      message: 'Could not read the uploaded file. Use a .csv or .xlsx file with a header row (name, phone, source, position, status).',
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

  for (let i = 0; i < rows.length; i++) {
    const row = rows[i];
    const name = field(row, 'name', 'full name', 'client name');
    if (!name) {
      errors.push(`Row ${i + 2}: missing name`);
      continue;
    }
    const rowTeam = rowTeams ? rowTeams[i] || '' : team;
    try {
      const lead = await new Lead({
        name,
        phone: field(row, 'phone', 'Phone'),
        source: field(row, 'source', 'Source') || 'Import',
        position: field(row, 'position', 'Position'),
        status: field(row, 'status', 'Status') || 'New',
        team: rowTeam,
        color: AVATAR_COLORS[Math.floor(Math.random() * AVATAR_COLORS.length)],
        importBatch: batch._id,
      }).save();
      created.push(lead);
    } catch (err) {
      errors.push(`Row ${i + 2}: ${err.message}`);
    }
  }

  batch.successCount = created.length;
  batch.failedCount = errors.length;
  batch.errors = errors.slice(0, 50);
  await batch.save();

  return res.status(200).json({
    success: true,
    result: { batch, leads: created },
    message: `Imported ${created.length} of ${rows.length} leads.`,
  });
};

module.exports = importLeads;
