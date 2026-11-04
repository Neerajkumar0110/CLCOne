const mongoose = require('mongoose');
const { notifyUser } = require('../../notify');

// Files every callback / booked demo / future follow-up due today that passed
// its time 15 minutes ago under whoever owns the lead (its assigned user, else
// whoever last moved it), and reminds them once. CLC-POL-001 section 10.
const GRACE_MS = 15 * 60 * 1000;
const TZ = 'Asia/Kolkata';
const KIND_LABEL = { callback: 'Callback', demo: 'Demo', followup: 'Follow-up' };

async function syncOverdue(now = new Date()) {
  const dayKey = now.toLocaleDateString('en-CA', { timeZone: TZ });
  const start = new Date(`${dayKey}T00:00:00+05:30`);
  const before = new Date(now.getTime() - GRACE_MS);
  const due = { $gte: start, $lte: before };
  const leads = await mongoose
    .model('Lead')
    .find({
      removed: false,
      $or: [{ stage: 'Callback', callBackAt: due }, { stage: 'Demo Booking', subStatus: 'Demo Booked', meetingAt: due }, { stage: 'Future Prospect', futureFollowUpAt: due }],
    })
    .select('name phone stage callBackAt meetingAt futureFollowUpAt assignedUser assignedUserName stageHistory')
    .limit(2000)
    .lean();
  const Task = mongoose.model('OverdueTask');
  let added = 0;
  for (const l of leads) {
    const last = (l.stageHistory || []).filter((h) => h.changedBy).slice(-1)[0];
    const admin = l.assignedUser || (last && last.changedBy);
    if (!admin) continue;
    const adminName = l.assignedUser ? l.assignedUserName : last.changedByName;
    const [kind, dueAt] = l.stage === 'Callback' ? ['callback', l.callBackAt] : l.stage === 'Demo Booking' ? ['demo', l.meetingAt] : ['followup', l.futureFollowUpAt];
    // eslint-disable-next-line no-await-in-loop
    const r = await Task.updateOne(
      { admin, lead: l._id, kind, dueAt },
      { $setOnInsert: { admin, adminName, lead: l._id, leadName: l.name, phone: l.phone, kind, dueAt, dayKey, status: 'open', created: now } },
      { upsert: true }
    );
    if (r.upsertedCount) {
      added += 1;
      notifyUser({ recipient: admin, module: 'Sales', type: 'task.overdue', title: `${KIND_LABEL[kind]} overdue: ${l.name}`, body: 'Update it, or give the reason in Sales 360° › Overdue tasks.', link: '/sales' });
    }
  }
  return added;
}

// Section 10: 2–3 attributable overdue tasks in a day = one short-leave event,
// 4 or more = two. Excluded ones don't count.
const eventsFor = (count) => (count >= 4 ? 2 : count >= 2 ? 1 : 0);

module.exports = { syncOverdue, eventsFor };
