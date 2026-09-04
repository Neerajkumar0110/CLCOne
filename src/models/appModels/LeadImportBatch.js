const mongoose = require('mongoose');

// One row per "Import Leads" run — powers the "Recent Import History" list.
const schema = new mongoose.Schema({
  removed: {
    type: Boolean,
    default: false,
  },
  enabled: {
    type: Boolean,
    default: true,
  },

  fileName: String,
  team: String,
  // Per-team row allocation when the import is manually split across teams
  // (rows are assigned to teams in this order); empty when a single team
  // (or no team) was used for the whole batch.
  teams: {
    type: [{ team: String, count: Number }],
    default: [],
  },
  totalRows: { type: Number, default: 0 },
  successCount: { type: Number, default: 0 },
  failedCount: { type: Number, default: 0 },
  // Rows skipped because a matching lead already exists (by phone, or by
  // name+email when no phone) or the same contact repeats within the file.
  duplicateCount: { type: Number, default: 0 },
  duplicates: {
    type: [{ name: String, phone: String, email: String, reason: String, row: Number }],
    default: [],
  },
  rowErrors: { type: [String], default: [] },
  importedBy: String,

  created: {
    type: Date,
    default: Date.now,
  },
  updated: {
    type: Date,
    default: Date.now,
  },
});

module.exports = mongoose.model('LeadImportBatch', schema);
