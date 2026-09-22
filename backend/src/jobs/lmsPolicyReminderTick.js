const mongoose = require('mongoose');
const realtime = require('../services/lms/realtime');
const mailer = require('../services/lms/mailer');

// Automatic reminders for a learner with a pending policy acknowledgement
// (spec §8 "Policy acknowledgement pending" trigger, email + in-app leg —
// the WhatsApp leg is intentionally not wired yet). Every tick, re-reminds
// any pending row not reminded within the configured cycle. Wrapped so a
// bad tick never crashes the process (same shape as jobs/lmsLiveTick.js).
const TICK_MS = Number(process.env.LMS_POLICY_REMINDER_TICK_MS || 6 * 60 * 60 * 1000); // 6h
const CYCLE_HOURS = Number(process.env.LMS_POLICY_REMINDER_CYCLE_HOURS || 48); // re-remind at most every 48h

async function tick() {
  require('../services/lms/health').ping('lmsPolicyReminderTick');
  try {
    const PolicyAcknowledgement = mongoose.model('PolicyAcknowledgement');
    const PolicyDocument = mongoose.model('PolicyDocument');
    const cutoff = new Date(Date.now() - CYCLE_HOURS * 3600 * 1000);
    const due = await PolicyAcknowledgement.find({
      removed: { $ne: true },
      status: 'pending',
      $or: [{ lastReminderAt: null }, { lastReminderAt: { $lte: cutoff } }],
    })
      .limit(500)
      .lean();
    if (!due.length) return;

    const policyIds = [...new Set(due.map((r) => String(r.policy)))];
    const policies = await PolicyDocument.find({ _id: { $in: policyIds }, status: 'published' }).select('title mandatory').lean();
    const byId = Object.fromEntries(policies.map((p) => [String(p._id), p]));

    // spec §2 "Archive/suspend/withdraw states must immediately affect all
    // scheduled communications" — a Dropped/On Hold/Completed/Deferred
    // student stops getting reminder pings even though their pending row
    // is still technically open.
    const Student = mongoose.model('Student');
    const emails = [...new Set(due.map((r) => (r.studentEmail || '').toLowerCase()).filter(Boolean))];
    const activeEmails = new Set(
      (await Student.find({ removed: false, status: 'Active', email: { $in: emails } }).select('email').lean()).map((s) => (s.email || '').toLowerCase())
    );

    for (const row of due) {
      const policy = byId[String(row.policy)];
      if (!policy) continue; // archived/removed since it was queued — skip
      if (row.studentEmail && !activeEmails.has(row.studentEmail.toLowerCase())) continue; // archived/suspended learner

      await realtime.notify([row.student], {
        type: 'lms.policy.reminder',
        title: `⏳ Pending acknowledgement: ${row.policyTitle}`,
        body: policy.mandatory ? 'This is mandatory — please acknowledge soon.' : 'Please review when you can.',
        link: '/learn/policies',
      });
      if (row.studentEmail) {
        mailer
          .sendMail([row.studentEmail], {
            subject: `Reminder: acknowledge "${row.policyTitle}"`,
            html: `<p>You still have a pending acknowledgement for <b>${row.policyTitle}</b> (v${row.policyVersion}). Please sign in to the portal to complete it.</p>`,
          })
          .catch(() => {});
      }
      await PolicyAcknowledgement.updateOne({ _id: row._id }, { $set: { lastReminderAt: new Date() }, $inc: { remindedCount: 1 } });
    }
  } catch (e) {
    console.error('[lms] policy reminder tick failed:', e.message);
  }
}

function start() {
  console.log(`[lms] policy reminder tick every ${Math.round(TICK_MS / 3600000)}h (re-remind cycle ${CYCLE_HOURS}h)`);
  tick();
  setInterval(tick, TICK_MS);
}

module.exports = start;
