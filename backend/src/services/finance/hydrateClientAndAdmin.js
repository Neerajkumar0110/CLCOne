const mongoose = require('mongoose');

// Manual replacement for the `autopopulate: true` that used to run on
// Invoice.client / Payment.client (-> salesDb) and Payment.createdBy
// (-> coreDb) — removed from the schemas because mongoose-autopopulate
// can't follow a ref across databases (it throws MissingSchemaError).
//
// Returns docs with `.client` / `.createdBy` replaced by the referenced
// document (same embedded shape autopopulate used to produce), so response
// JSON is unchanged. Always returns plain objects (never mutates a live
// Mongoose document in place, since assigning a populated object onto an
// ObjectId-typed path can trigger unwanted casting) — callers should use
// the returned value, not assume the input was mutated.
//
// `docs` may be a single doc, an array, or null/undefined — all safe.
async function hydrateClientAndAdmin(docs, { clientSelect, adminSelect } = {}) {
  const isArray = Array.isArray(docs);
  const input = isArray ? docs : docs ? [docs] : [];
  const list = input.map((d) => (d && typeof d.toObject === 'function' ? d.toObject() : d));

  if (list.length === 0) return isArray ? list : list[0] ?? docs;

  const Client = mongoose.model('Client');
  const Admin = mongoose.model('Admin');

  const clientIds = uniqueIds(list.map((d) => d.client));
  const adminIds = uniqueIds(list.map((d) => d.createdBy));

  const [clients, admins] = await Promise.all([
    clientIds.length ? Client.find({ _id: { $in: clientIds } }).select(clientSelect).lean() : [],
    adminIds.length ? Admin.find({ _id: { $in: adminIds } }).select(adminSelect).lean() : [],
  ]);

  const clientById = new Map(clients.map((c) => [String(c._id), c]));
  const adminById = new Map(admins.map((a) => [String(a._id), a]));

  for (const doc of list) {
    if (doc.client != null) doc.client = clientById.get(String(doc.client)) || doc.client;
    if (doc.createdBy != null) doc.createdBy = adminById.get(String(doc.createdBy)) || doc.createdBy;
  }

  return isArray ? list : list[0];
}

function uniqueIds(values) {
  const seen = new Set();
  const out = [];
  for (const v of values) {
    if (v == null) continue;
    const key = String(v);
    if (!seen.has(key)) {
      seen.add(key);
      out.push(v);
    }
  }
  return out;
}

module.exports = { hydrateClientAndAdmin };
