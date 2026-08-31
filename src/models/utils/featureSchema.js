const mongoose = require('mongoose');

// Shared Mongoose schema builder for the six new feature sections
// (Sales, Marketing, Operations, LMS, HR, Messenger). Every model gets the
// IDURAR-standard removed / enabled / created / updated fields plus whatever
// `fields` describes, then flows through the generic createCRUDController —
// no custom controller or route wiring needed (see routes/appRoutes/appApi.js
// + controllers/appControllers/index.js). `fields` is the same shape the
// frontend uses in config/featureSections.js so the form, table and schema
// stay in step.
function featureSchema(fields = []) {
  const def = {
    removed: { type: Boolean, default: false },
    enabled: { type: Boolean, default: true },
  };

  for (const f of fields) {
    const t = f.type || 'String';
    let mongoType = String;
    if (t === 'Number') mongoType = Number;
    else if (t === 'Date') mongoType = Date;
    else if (t === 'Boolean') mongoType = Boolean;
    else if (t === '[String]') mongoType = [String];

    const entry = { type: mongoType };
    if (f.required) entry.required = true;
    if (Array.isArray(f.enum) && f.enum.length) entry.enum = f.enum;
    if (f.default !== undefined) entry.default = f.default;
    def[f.name] = entry;
  }

  def.created = { type: Date, default: Date.now };
  def.updated = { type: Date, default: Date.now };

  return new mongoose.Schema(def);
}

module.exports = { featureSchema };
