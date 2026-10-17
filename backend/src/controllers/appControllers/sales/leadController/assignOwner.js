const mongoose = require('mongoose');
const { SALES_ROLES } = require('../../../../config/roles');
const { FULL_ACCESS_ROLES } = require('../../../../services/access/salesScope');
const { leadScopeFilter } = require('./scope');
const { buildLeadListFilter } = require('./byStage');

// POST /api/lead/assign-owner — Lead Owner (Lead Stages page), management
// only (owner/Super Admin/Admin/Sales Manager/Team Manager).
//
// Which leads:
//   leadIds: [...]                 — the rows ticked in the Lead List, or one lead
//   filter: {...by-stage params}   — every lead the Lead List currently shows
//     limit: N                     —   optional: only the first N of them
// To whom:
//   owners: [{ userId, count? }]   — active Sales users
//   mode: 'equal'  — split the leads evenly (one owner = all of them)
//         'custom' — each owner gets exactly `count`, in the order given
//   unassign: true — clear the owner instead (owners ignored)
//
// Leads are taken newest-stage-change first, the same order the list shows.
const MAX_LEADS = 20000;

function bad(res, message, status = 400) {
  return res.status(status).json({ success: false, result: null, message });
}

const assignOwner = async (req, res) => {
  if (!FULL_ACCESS_ROLES.includes(req.admin.role)) return bad(res, 'Only management can change lead owners.', 403);

  const Lead = mongoose.model('Lead');
  const Admin = mongoose.model('Admin');
  const b = req.body || {};
  const unassign = !!b.unassign;
  const mode = b.mode === 'custom' ? 'custom' : 'equal';

  // ── owners ──
  let owners = [];
  if (!unassign) {
    const wanted = (Array.isArray(b.owners) ? b.owners : []).filter((o) => o && mongoose.isValidObjectId(o.userId));
    if (!wanted.length) return bad(res, 'Pick at least one owner.');
    const ids = [...new Set(wanted.map((o) => String(o.userId)))];
    const users = await Admin.find({ _id: { $in: ids }, removed: false }).select('name surname role enabled').lean();
    const byId = new Map(users.map((u) => [String(u._id), u]));
    for (const o of wanted) {
      const u = byId.get(String(o.userId));
      if (!u || !u.enabled || !SALES_ROLES.includes(u.role)) {
        return bad(res, 'Leads can only be given to active Sales users.');
      }
      if (owners.some((x) => String(x._id) === String(u._id))) continue;
      const count = Math.max(0, parseInt(o.count, 10) || 0);
      if (mode === 'custom' && !count) continue;
      owners.push({ _id: u._id, name: `${u.name} ${u.surname || ''}`.trim(), count });
    }
    if (!owners.length) return bad(res, 'Give at least one owner a number of leads.');
  }

  // ── leads ──
  const scope = await leadScopeFilter(req.admin, req);
  let match;
  if (Array.isArray(b.leadIds) && b.leadIds.length) {
    const ids = b.leadIds.filter((id) => mongoose.isValidObjectId(id));
    if (!ids.length) return bad(res, 'No valid leads selected.');
    match = { removed: false, _id: { $in: ids } };
  } else if (b.filter && typeof b.filter === 'object') {
    match = buildLeadListFilter(b.filter);
  } else {
    return bad(res, 'Pick the leads to assign.');
  }
  const query = Object.keys(scope).length ? { $and: [match, scope] } : match;

  const customTotal = !unassign && mode === 'custom' ? owners.reduce((t, o) => t + o.count, 0) : 0;
  if (customTotal > MAX_LEADS) return bad(res, `At most ${MAX_LEADS} leads can be assigned at once.`);
  let want = customTotal || MAX_LEADS;
  if (b.limit) want = Math.min(want, Math.max(1, parseInt(b.limit, 10) || MAX_LEADS));
  want = Math.min(want, MAX_LEADS);

  const leads = await Lead.find(query)
    .sort({ stageUpdatedAt: -1, _id: 1 })
    .limit(want)
    .select('_id assignedUserName')
    .lean();
  if (!leads.length) return bad(res, 'No leads match.');
  if (customTotal && leads.length < customTotal) {
    return bad(res, `Only ${leads.length} lead(s) match, but the owner counts add up to ${customTotal}.`);
  }

  // ── split ──
  const plan = []; // [{ owner|null, ids }]
  if (unassign) {
    plan.push({ owner: null, ids: leads.map((l) => l._id) });
  } else if (mode === 'custom') {
    let at = 0;
    for (const o of owners) {
      plan.push({ owner: o, ids: leads.slice(at, at + o.count).map((l) => l._id) });
      at += o.count;
    }
  } else {
    // Even split in contiguous blocks; the first `extra` owners take one more.
    const per = Math.floor(leads.length / owners.length);
    const extra = leads.length % owners.length;
    let at = 0;
    owners.forEach((o, i) => {
      const n = per + (i < extra ? 1 : 0);
      plan.push({ owner: o, ids: leads.slice(at, at + n).map((l) => l._id) });
      at += n;
    });
  }

  const byName = `${req.admin.name} ${req.admin.surname || ''}`.trim();
  const now = new Date();
  const prevName = new Map(leads.map((l) => [String(l._id), l.assignedUserName || '']));
  const ops = [];
  for (const p of plan) {
    for (const id of p.ids) {
      ops.push({
        updateOne: {
          filter: { _id: id },
          update: {
            $set: { assignedUser: p.owner ? p.owner._id : null, assignedUserName: p.owner ? p.owner.name : '' },
            $push: {
              ownerHistory: {
                $each: [{ fromName: prevName.get(String(id)) || '', to: p.owner ? p.owner._id : undefined, toName: p.owner ? p.owner.name : '', byName, at: now }],
                $slice: -50,
              },
            },
          },
        },
      });
    }
  }
  for (let i = 0; i < ops.length; i += 1000) {
    await Lead.bulkWrite(ops.slice(i, i + 1000), { ordered: false });
  }

  // A New Lead that now has an owner is the rep's to work by hand — drop it
  // from the Instant Lead Pool queue while the pool is dialing unassigned New
  // Leads (see jobs/leadPoolSyncTick.js).
  if (!unassign) {
    const camp = await mongoose
      .model('CallCampaign')
      .findOne({ isLeadPool: true, removed: false })
      .select('_id leadPoolStage leadPoolStages')
      .lean();
    if (camp && require('../../../../jobs/leadPoolSyncTick').stagesOf(camp).includes('New Lead')) {
      await mongoose.model('CallLead').updateMany(
        { campaign: camp._id, removed: false, status: { $in: ['New', 'Queued'] }, crmLead: { $in: leads.map((l) => l._id) } },
        { $set: { removed: true, updated: now } }
      );
    }
  }

  const summary = plan.map((p) => ({ userId: p.owner ? p.owner._id : null, name: p.owner ? p.owner.name : 'Unassigned', count: p.ids.length }));
  return res.status(200).json({
    success: true,
    result: { total: leads.length, owners: summary },
    message: unassign
      ? `Owner removed from ${leads.length} lead(s).`
      : `${leads.length} lead(s) assigned — ${summary.map((s) => `${s.name}: ${s.count}`).join(', ')}.`,
  });
};

module.exports = assignOwner;
