const mongoose = require('mongoose');

// Permanently deletes a user that is already in "Deleted Users" (soft-deleted,
// removed: true) — User Management › Deleted Users › "Delete permanently"
// (user ask 2026-11-28: delete properly from the DB, by role).
//
// Everything is matched by the account's _id — NEVER by email or name alone:
// one email can belong to two accounts (e.g. the owner and a Candidate made
// with the same address), and the other account's data must stay.
//
// Deleted: the account + its login, its own personal records (sessions,
// attendance, notifications to it, dialer state) and its role's data:
//   Candidate (Student) → LMS student record, test attempts, policy consents,
//                         onboarding, learner profile, activity/score history,
//                         Moodle map, join attempts.
//   Teacher             → removed from every batch's trainer list; its classes
//                         in batches that are already deleted.
//   anyone in a dialer campaign → taken off its agent list.
// Its WhatsApp chats with leads and its call records stay (business history).
// Kept (history other people rely on): audit logs, tickets, emails sent, things
// it created for others, classes of live batches, notifications it sent.

const ROLE_STUDENT = 'Student';
const ROLE_TEACHER = 'Teacher';
const PROTECTED_ROLES = ['owner'];

const db = (name) => mongoose.connection.useDb(name, { useCache: true }).db;
const both = (id) => [id, String(id)];

async function exists(dbName, col) {
  const list = await db(dbName).listCollections({ name: col }).toArray();
  return list.length > 0;
}

// [dbName, collection, filter] — filters built from the account's ids only
function plan(admin, ctx) {
  const id = admin._id;
  const ids = { $in: both(id) };
  const steps = [
    ['coreDb', 'adminpasswords', { user: ids }],
    ['hrmsDb', 'loginactivities', { admin: ids }],
    ['hrmsDb', 'worksessions', { admin: ids }],
    ['hrmsDb', 'erpsessions', { admin: ids }],
    ['hrmsDb', 'erpactivities', { admin: ids }],
    ['hrmsDb', 'erpprofiles', { admin: ids }],
    ['hrmsDb', 'erpdevices', { admin: ids }],
    ['hrmsDb', 'erpdeviceevents', { admin: ids }],
    ['operationDb', 'notifications', { recipient: ids }],
    ['operationDb', 'agentcallstates', { agent: ids }],
    ['operationDb', 'agentactivities', { agent: ids }],
    ['operationDb', 'userevents', { admin: ids }],
    ['lmsDb', 'moodleusermaps', { crmUser: ids }],
  ];
  // The per-user permission row is keyed by email — only when no other
  // account still uses that email.
  if (admin.email && !ctx.emailShared) steps.push(['coreDb', 'permissions', { scope: 'user', key: admin.email }]);

  if (admin.role === ROLE_STUDENT) {
    steps.push(
      ['lmsDb', 'assessmentattempts', { candidate: ids }],
      ['lmsDb', 'policyacknowledgements', { student: ids }],
      ['lmsDb', 'feedbackreminders', { student: ids }],
      ['lmsDb', 'onboardingprogresses', { student: ids }],
      ['lmsDb', 'lmslearnerprofiles', { crmUser: ids }],
      ['lmsDb', 'lmsactivitydays', { crmUser: ids }],
      ['lmsDb', 'lmsscoresnapshots', { crmUser: ids }],
      ['lmsDb', 'lmsengagementalerts', { learner: ids }],
      ['lmsDb', 'lmsjoinattempts', { crmUser: ids }],
      ['lmsDb', 'codehelprequests', { owner: ids }]
    );
    // The LMS student record carries no account id, only the email — safe
    // only when no other Candidate account uses that email.
    if (admin.email && !ctx.studentEmailShared) steps.push(['lmsDb', 'students', { email: admin.email }]);
  }
  if (admin.role === ROLE_TEACHER && ctx.teacherName && ctx.deadBatchNames.length) {
    steps.push(['lmsDb', 'liveclasses', { trainer: ctx.teacherName, batch: { $in: ctx.deadBatchNames } }]);
  }
  steps.push(['coreDb', 'admins', { _id: id }]);
  return steps;
}

async function context(admin) {
  const core = db('coreDb');
  const sameEmail = admin.email ? await core.collection('admins').find({ _id: { $ne: admin._id }, email: admin.email }).project({ role: 1 }).toArray() : [];
  const ctx = {
    emailShared: sameEmail.length > 0,
    studentEmailShared: sameEmail.some((a) => a.role === ROLE_STUDENT),
    teacherName: [admin.name, admin.surname].filter(Boolean).join(' ').trim(),
    deadBatchNames: [],
  };
  if (admin.role === ROLE_TEACHER && ctx.teacherName) {
    const dead = await db('lmsDb').collection('batches').find({ removed: true, trainer: ctx.teacherName }).project({ name: 1 }).toArray();
    ctx.deadBatchNames = dead.map((b) => b.name).filter(Boolean);
  }
  return ctx;
}

// dryRun → counts (+ the docs when `withDocs`) without deleting anything.
async function purgeUser(adminId, { by, dryRun = false, withDocs = false } = {}) {
  if (!mongoose.isValidObjectId(adminId)) return { ok: false, error: 'Bad user id.' };
  const id = new mongoose.Types.ObjectId(String(adminId));
  const admin = await db('coreDb').collection('admins').findOne({ _id: id });
  if (!admin) return { ok: false, error: 'User not found.' };
  if (!admin.removed) return { ok: false, error: 'Delete the user first (it moves to Deleted Users), then delete permanently.' };
  if (PROTECTED_ROLES.includes(admin.role)) return { ok: false, error: 'The owner account can never be deleted.' };
  if (by && String(by._id) === String(id)) return { ok: false, error: 'You cannot delete your own account.' };

  const ctx = await context(admin);
  const steps = plan(admin, ctx);
  const counts = {};
  const docs = {};
  for (const [dbName, col, filter] of steps) {
    if (!(await exists(dbName, col))) continue;
    const c = db(dbName).collection(col);
    const n = await c.countDocuments(filter);
    if (!n) continue;
    counts[`${dbName}.${col}`] = n;
    if (withDocs) docs[`${dbName}.${col}`] = await c.find(filter).toArray();
    if (!dryRun) await c.deleteMany(filter);
  }
  // Teacher: off every batch's trainer list (array or plain string field)
  if (admin.role === ROLE_TEACHER && ctx.teacherName) {
    const b = db('lmsDb').collection('batches');
    const n = await b.countDocuments({ trainer: ctx.teacherName });
    if (n) {
      counts['lmsDb.batches (trainer removed)'] = n;
      if (withDocs) docs['lmsDb.batches (before)'] = await b.find({ trainer: ctx.teacherName }).toArray();
      if (!dryRun) {
        await b.updateMany({ trainer: ctx.teacherName, 'trainer.0': { $exists: true } }, { $pull: { trainer: ctx.teacherName } });
        await b.updateMany({ trainer: ctx.teacherName }, { $set: { trainer: '' } });
      }
    }
  }
  // Off every dialer campaign's agent list
  if (await exists('operationDb', 'callcampaigns')) {
    const cc = db('operationDb').collection('callcampaigns');
    const f = { agents: { $in: both(id) } };
    const n = await cc.countDocuments(f);
    if (n) {
      counts['operationDb.callcampaigns (agent removed)'] = n;
      if (withDocs) docs['operationDb.callcampaigns (before)'] = await cc.find(f).toArray();
      if (!dryRun) await cc.updateMany(f, { $pull: { agents: { $in: both(id) } } });
    }
  }
  if (!dryRun) {
    try {
      await db('lmsDb').collection('auditlogs').insertOne({
        action: 'user.purged',
        entity: 'Admin',
        entityId: String(id),
        performedBy: by ? by._id : null,
        performedByName: by ? [by.name, by.surname].filter(Boolean).join(' ') : 'system',
        details: { email: admin.email, role: admin.role, name: ctx.teacherName, counts },
        created: new Date(),
        removed: false,
      });
    } catch (e) {
      /* the audit row is best-effort */
    }
  }
  return { ok: true, user: { _id: String(id), email: admin.email, role: admin.role, name: ctx.teacherName }, emailShared: ctx.emailShared, counts, ...(withDocs ? { docs } : {}) };
}

module.exports = { purgeUser };
