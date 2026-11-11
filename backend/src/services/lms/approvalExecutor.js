const mongoose = require('mongoose');
const audit = require('./auditLog');
const realtime = require('./realtime');

// What happens once an Ops request (LmsApproval) gets its final approval —
// spec §17: automation detects, a person approves, then the system carries
// the decision out instead of someone re-typing it on another screen.
//
//   Status change / Mark as Dropped → learner status set (the Student hooks
//     hold or release the LMS login and tell the learner)
//   Mass message                    → announcement sent (in-app + email) to
//     the requested batches
//   Deadline extension              → project + next milestone moved, the
//     learner's ticket answered, learner + PM told
//   Duplicate class removal         → the extra un-started class removed
//   Certificate correction          → corrected certificate with a new ID,
//     the old one kept as "Replaced"
//   anything else (attendance dispute, readiness / eligibility exception,
//     other)                        → needs a person; the requester is told
//
// The outcome is stored on the request (execution) and audited. A failure
// never undoes the approval — it is shown as failed so someone can act.

const M = (n) => mongoose.model(n);
const esc = (s) => String(s || '').replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const rxEq = (s) => new RegExp(`^${esc(s)}$`, 'i');
const lc = (s) => String(s || '').trim().toLowerCase();
const nameOf = (a) => [a && a.name, a && a.surname].filter(Boolean).join(' ') || (a && a.email) || 'staff';
const DAY = 86400000;
const STATUSES = ['Active', 'On Hold', 'Completed', 'Dropped', 'Deferred', 'Suspended', 'Withdrawn', 'Archived'];

class Manual extends Error {}

async function accountIdsFor(emails) {
  const list = [...new Set(emails.map(lc).filter(Boolean))];
  if (!list.length) return [];
  const acc = await M('Admin').find({ removed: false, email: { $in: list.map(rxEq) } }).select('_id').lean();
  return acc.map((a) => a._id);
}

// ── status change ──────────────────────────────────────────────────────────
async function findStudent(doc) {
  const p = doc.payload || {};
  const id = p.studentId || (/^student:([a-f0-9]{24})$/i.exec(doc.ref || '') || [])[1];
  if (id && mongoose.isValidObjectId(id)) return M('Student').findOne({ _id: id, removed: false });
  if (!doc.learnerName) return null;
  const hits = await M('Student').find({ removed: false, name: rxEq(doc.learnerName.trim()), ...(doc.scope ? { batch: doc.scope } : {}) }).limit(2);
  return hits.length === 1 ? hits[0] : null;
}

function targetStatus(doc) {
  const p = doc.payload || {};
  if (STATUSES.includes(p.to)) return p.to;
  if (doc.type === 'Mark as Dropped') return 'Dropped';
  // "Active → Suspended" or just "Suspended"
  const tail = String(doc.detail || '').split(/→|->/).pop().trim();
  return STATUSES.find((s) => lc(s) === lc(tail)) || null;
}

async function runStatus(doc, admin) {
  const to = targetStatus(doc);
  if (!to) throw new Manual('No target status in the request — set it on the Learners board.');
  const s = await findStudent(doc);
  if (!s) throw new Manual(`Learner "${doc.learnerName}" not found uniquely — set the status on the Learners board.`);
  if (s.status === to) return `${s.name} was already ${to}.`;
  const from = s.status;
  s.status = to;
  await s.save(); // Student post-save hook holds / releases the LMS login and notifies the learner
  await audit.record({ module: 'student', action: 'status.change', entityType: 'Student', entityId: s._id, admin, reason: `approved request ${doc._id}`, after: { from, to } });
  return `${s.name}: ${from} → ${to}${to === 'Active' ? ' · LMS access restored' : ' · LMS access held'}.`;
}

// ── mass message ───────────────────────────────────────────────────────────
async function sendAnnouncement({ title, body, batches, all, actor }) {
  const rq = { removed: false, status: 'Active' };
  if (!all) rq.batch = { $in: batches };
  const roster = await M('Student').find(rq).select('email batch').lean();
  const emails = [...new Set(roster.map((r) => lc(r.email)).filter(Boolean))];
  const created = [];
  for (const b of all ? [null] : batches) {
    // eslint-disable-next-line no-await-in-loop
    created.push(await M('LmsAnnouncement').create({
      teacherCrmUser: actor._id,
      teacherName: nameOf(actor),
      title,
      body,
      audience: b ? 'batch' : 'all',
      batch: b || undefined,
      priority: 'important',
      channels: ['in_app', 'email'],
      recipientsCount: b ? roster.filter((r) => r.batch === b).length : emails.length,
      sentAt: new Date(),
    }));
  }
  const ids = await accountIdsFor(emails);
  if (ids.length) await realtime.notify(ids, { type: 'lms.announcement', title: `📢 ${title}`, body, link: '/learn/notifications', actorName: nameOf(actor) });
  let emailed = 0;
  if (emails.length) {
    try {
      const vars = { title, message: body, from: nameOf(actor) };
      const r = await require('./mailer').sendMail(emails, { ...require('../mail/inlineEmails').announcement(vars), templateKey: 'lms-ops-announcement', vars });
      emailed = (r && r.sent) || 0;
    } catch (e) {
      /* in-app already delivered; email failure shows in the delivery log */
    }
  }
  await Promise.all(created.map((a) => M('LmsAnnouncement').updateOne({ _id: a._id }, { $set: { emailedCount: emailed } })));
  return { recipients: emails.length, notified: ids.length, emailed };
}

async function runMassMessage(doc, admin) {
  const p = doc.payload || {};
  const text = String(p.text || doc.detail || '').trim();
  if (!text) throw new Manual('The request has no message text.');
  const all = p.all === true || /^all( batches)?$/i.test(String(doc.scope || '').trim());
  let batches = [];
  if (!all) {
    const want = (Array.isArray(p.batches) && p.batches.length ? p.batches : String(doc.scope || '').split(',')).map((x) => String(x).trim()).filter(Boolean);
    const found = await M('Batch').find({ removed: false, name: { $in: want } }).select('name').lean();
    batches = found.map((b) => b.name);
    if (!batches.length) throw new Manual(`No batch matches "${doc.scope}" — send it from Announcements.`);
  }
  const requester = doc.requestedBy ? await M('Admin').findById(doc.requestedBy).select('name surname email').lean() : null;
  const title = String(p.title || text.split('\n')[0]).slice(0, 90);
  const r = await sendAnnouncement({ title, body: text, batches, all, actor: requester || admin });
  return `Sent to ${all ? 'all batches' : batches.join(', ')} · ${r.recipients} learners · ${r.notified} in-app · ${r.emailed} emailed.`;
}

// ── deadline extension ─────────────────────────────────────────────────────
const MON = { jan: 0, feb: 1, mar: 2, apr: 3, may: 4, jun: 5, jul: 6, aug: 7, sep: 8, oct: 9, nov: 10, dec: 11 };
function parseNewDue(texts, base) {
  for (const raw of texts) {
    const t = String(raw || '');
    let m = /(\d{4})-(\d{2})-(\d{2})/.exec(t);
    if (m) return new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]), 23, 59);
    m = /\b(\d{1,2})[/.](\d{1,2})[/.](\d{4})\b/.exec(t);
    if (m) return new Date(Number(m[3]), Number(m[2]) - 1, Number(m[1]), 23, 59);
    m = /\b(\d{1,2})\s*(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*\.?(?:\s*,?\s*(\d{4}))?/i.exec(t);
    if (m) {
      const y = m[3] ? Number(m[3]) : new Date().getFullYear();
      let d = new Date(y, MON[m[2].toLowerCase()], Number(m[1]), 23, 59);
      if (!m[3] && d < new Date(Date.now() - 30 * DAY)) d = new Date(y + 1, d.getMonth(), d.getDate(), 23, 59);
      return d;
    }
    m = /\b(\d{1,2})\s*(days?|din)\b/i.exec(t);
    if (m) return new Date(Math.max(base ? new Date(base).getTime() : 0, Date.now()) + Number(m[1]) * DAY);
  }
  return null;
}

async function runExtension(doc, admin, reason) {
  const ticket = doc.ref && mongoose.isValidObjectId(doc.ref) ? await M('Ticket').findOne({ _id: doc.ref, removed: false }) : null;
  const email = ticket ? ticket.raisedByEmail : (doc.payload && doc.payload.email) || '';
  const code = ((ticket && ticket.reference) || doc.detail || '').split('·')[0].trim();
  let project = null;
  if (email) {
    const q = { removed: false, studentEmail: rxEq(email) };
    project = (code && (await M('Project').findOne({ ...q, code }))) || null;
    if (!project) {
      const open = await M('Project').find({ ...q, status: { $nin: ['approved', 'rejected'] } }).limit(2);
      if (open.length === 1) [project] = open;
    }
  }
  if (!project) throw new Manual('Project not found for this learner — move the due date on the Projects page.');
  // what the approver wrote wins, then the request detail, then what the learner asked for
  const newDue = parseNewDue([reason, doc.detail, ticket && ticket.description], project.dueDate);
  if (!newDue || newDue < new Date()) throw new Manual('No new date found — write it in the approval reason (e.g. "7 days" or "2026-11-20") or move it on the Projects page.');
  const before = project.dueDate;
  project.dueDate = newDue;
  const next = (project.milestones || []).find((m) => m.status !== 'done');
  if (next && (!next.dueDate || next.dueDate < newDue)) next.dueDate = newDue;
  project.markModified('milestones');
  await project.save();
  const day = newDue.toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' });
  if (ticket && ticket.status !== 'Resolved') {
    ticket.status = 'Resolved';
    ticket.stage = 'Resolved';
    ticket.resolvedAt = new Date();
    ticket.resolvedByName = nameOf(admin);
    ticket.resolutionNote = `Extension approved — new due date ${day}.`;
    ticket.history = [...(ticket.history || []), { at: new Date(), action: 'status', status: 'Resolved', byName: nameOf(admin), note: 'Extension approved by Ops' }];
    await ticket.save();
  }
  const ids = [...(await accountIdsFor([email])), ...(project.mentor ? [project.mentor] : [])];
  if (ids.length) await realtime.notify(ids, { type: 'lms.project.extension', title: `📅 Extension approved: ${project.title}`, body: `${project.studentName || email} · new due date ${day}.`, link: '/learn/projects', actorName: nameOf(admin) });
  await audit.record({ module: 'project', action: 'extension', entityType: 'Project', entityId: project._id, admin, reason: `approved request ${doc._id}`, before: { dueDate: before }, after: { dueDate: newDue } });
  return `${project.title}: due ${day}${ticket ? ' · ticket answered' : ''} · learner + PM told.`;
}

// ── duplicate class ────────────────────────────────────────────────────────
const istDay = (d) => new Date(new Date(d).getTime() + 5.5 * 3600000).toISOString().slice(0, 10);

async function removeDuplicateClass(sessionId, admin, reason) {
  const S = M('LmsLiveSession');
  const s = mongoose.isValidObjectId(sessionId) ? await S.findOne({ _id: sessionId, removed: false }) : null;
  if (!s) throw new Manual('That class is already gone.');
  if (!['scheduled', 'upcoming'].includes(s.status) || s.actualStart) throw new Manual(`The class has already ${s.status === 'cancelled' ? 'been cancelled' : 'started'} — not removed.`);
  s.removed = true;
  s.status = 'cancelled';
  s.cancelReason = String(reason || 'Duplicate class').slice(0, 500);
  s.cancelledBy = admin._id;
  s.cancelledByName = nameOf(admin);
  s.cancelledAt = new Date();
  s.updated = new Date();
  await s.save();
  if (s.liveClass) await M('LiveClass').updateOne({ _id: s.liveClass }, { $set: { removed: true, status: 'Cancelled', updated: new Date() } });
  let renumbered = 0;
  if (s.batch) {
    // only a day left with no class becomes a holiday (so a regenerate does
    // not bring it back) — the class this one duplicated stays scheduled
    const sameDay = await S.find({ batch: s.batch, removed: false, status: { $ne: 'cancelled' } }).select('scheduledStart').lean();
    if (!sameDay.some((x) => istDay(x.scheduledStart) === istDay(s.scheduledStart))) {
      await M('Batch').updateOne({ _id: s.batch }, { $addToSet: { holidays: istDay(s.scheduledStart) } });
    }
    const svc = require('./liveClassService');
    if (typeof svc.renumberBatchSessions === 'function') renumbered = await svc.renumberBatchSessions(s.batch, s.batchName);
  }
  await audit.record({ module: 'liveclass', action: 'duplicate.remove', entityType: 'LmsLiveSession', entityId: s._id, admin, reason, after: { title: s.title, scheduledStart: s.scheduledStart } });
  return { title: s.title, renumbered };
}

async function runDuplicate(doc, admin) {
  const p = doc.payload || {};
  const asked = (p.sessionIds && p.sessionIds.length ? p.sessionIds : [p.sessionId || (/^session:([a-f0-9]{24})$/i.exec(doc.ref || '') || [])[1]]).filter(Boolean).map(String);
  // re-check at execution time: only a class that is STILL a duplicate (its
  // twin still scheduled) is removed
  const groups = await require('./duplicateClasses').detect({ batches: doc.scope ? [doc.scope] : undefined, to: new Date(Date.now() + 365 * DAY) });
  const still = new Set(groups.flatMap((g) => g.extras.map((e) => e.id)));
  const removed = [];
  const skipped = [];
  for (const id of asked) {
    if (!still.has(id)) {
      skipped.push(id);
      continue;
    }
    try {
      // eslint-disable-next-line no-await-in-loop
      removed.push((await removeDuplicateClass(id, admin, `Duplicate class — approved request ${doc._id}`)).title);
    } catch (e) {
      skipped.push(id);
    }
  }
  if (!removed.length) throw new Manual(`Nothing removed — ${skipped.length} class(es) are no longer duplicates or have started.`);
  return `Removed ${removed.length} duplicate class${removed.length > 1 ? 'es' : ''}${removed.length === 1 ? ` ("${removed[0]}")` : ''}${skipped.length ? ` · ${skipped.length} skipped (no longer duplicate / started)` : ''} · class numbers renumbered.`;
}

// ── certificate correction ─────────────────────────────────────────────────
async function correctCertificate(certId, { name, course, reason }, admin) {
  const crypto = require('crypto');
  const C = M('Certificate');
  const old = mongoose.isValidObjectId(certId) ? await C.findOne({ _id: certId, removed: false }) : null;
  if (!old) throw new Manual('Certificate not found.');
  if (!['Issued', 'Sent'].includes(old.status)) throw new Manual(`Only an issued certificate can be corrected (this one is ${old.status}).`);
  const newName = String(name || old.student).trim();
  const newCourse = String(course || old.course || '').trim();
  if (newName === old.student && newCourse === (old.course || '')) throw new Manual('Nothing to correct — name and course are unchanged.');
  const certificateId = `CLC-${new Date().getFullYear()}-${crypto.randomBytes(4).toString('hex').toUpperCase()}`;
  const fresh = await C.create({
    student: newName,
    course: newCourse,
    batch: old.batch,
    certificateId,
    title: old.title,
    type: old.type,
    issuedOn: new Date(),
    validUntil: old.validUntil,
    grade: old.grade,
    score: old.score,
    status: 'Issued',
    verificationUrl: `/verify/${certificateId}`,
    issuedBy: `${nameOf(admin)} (correction)`,
    replaces: old.certificateId,
    correctionReason: String(reason || '').slice(0, 500),
  });
  old.status = 'Replaced';
  old.replacedBy = certificateId;
  old.correctionReason = String(reason || '').slice(0, 500);
  old.updated = new Date();
  await old.save();
  await audit.record({ module: 'certificate', action: 'correct', entityType: 'Certificate', entityId: fresh._id, admin, reason, before: { certificateId: old.certificateId, student: old.student, course: old.course }, after: { certificateId, student: newName, course: newCourse } });
  return { old: old.certificateId, certificateId, id: String(fresh._id) };
}

async function runCertificate(doc, admin) {
  const p = doc.payload || {};
  const r = await correctCertificate(p.certId, { name: p.name, course: p.course, reason: doc.evidence }, admin);
  return `New certificate ${r.certificateId} issued · ${r.old} marked Replaced (verify page points to the new ID).`;
}

const RUNNERS = {
  'Status change': runStatus,
  'Mark as Dropped': runStatus,
  'Mass message': runMassMessage,
  'Deadline extension': runExtension,
  'Duplicate class removal': runDuplicate,
  'Certificate correction': runCertificate,
};
const MANUAL_NOTE = {
  'Attendance dispute': 'Approved — correct the classes on the Attendance board (reason is kept).',
  'Readiness exception': 'Approved — the learner may proceed without the readiness gate.',
  'Eligibility override': 'Approved — issue from the Certificates board.',
  Other: 'Approved — act on it as described in the request.',
};

async function tell(doc, title, body, admin) {
  if (!doc.requestedBy || String(doc.requestedBy) === String(admin._id)) return;
  await realtime.notify([doc.requestedBy], { type: 'lms.approval', title, body, link: '/admin-ops/approvals', actorName: nameOf(admin) }).catch(() => {});
}

// Called once a request reaches its final decision.
async function onDecided(doc, admin, reason) {
  require('./health').ping('approvalExecutor');
  if (doc.status === 'rejected') {
    // the learner who asked through a ticket hears the answer too
    if (doc.type === 'Deadline extension' && doc.ref && mongoose.isValidObjectId(doc.ref)) {
      const t = await M('Ticket').findOne({ _id: doc.ref, removed: false });
      if (t && t.status !== 'Resolved') {
        t.status = 'Resolved';
        t.stage = 'Resolved';
        t.resolvedAt = new Date();
        t.resolvedByName = nameOf(admin);
        t.resolutionNote = `Extension not approved: ${reason}`;
        t.history = [...(t.history || []), { at: new Date(), action: 'status', status: 'Resolved', byName: nameOf(admin), note: 'Extension rejected by Ops' }];
        await t.save();
        if (t.createdBy) await realtime.notify([t.createdBy], { type: 'lms.ticket.update', title: `Extension request: not approved`, body: String(reason).slice(0, 200), link: '/learn/support', actorName: nameOf(admin) }).catch(() => {});
      }
    }
    await tell(doc, `✗ Request rejected: ${doc.type}`, `${doc.learnerName || doc.scope} · ${reason}`, admin);
    return null;
  }
  if (doc.status !== 'approved') return null;
  const run = RUNNERS[doc.type];
  let execution;
  try {
    if (!run) throw new Manual(MANUAL_NOTE[doc.type] || MANUAL_NOTE.Other);
    execution = { status: 'done', at: new Date(), note: String(await run(doc, admin, reason)).slice(0, 500) };
  } catch (e) {
    execution = { status: e instanceof Manual ? 'manual' : 'failed', at: new Date(), note: String(e.message || e).slice(0, 500) };
  }
  await M('LmsApproval').updateOne({ _id: doc._id }, { $set: { execution } });
  doc.execution = execution;
  await audit.record({ module: 'approval', action: `execute.${execution.status}`, entityType: 'LmsApproval', entityId: doc._id, admin, reason: execution.note, meta: { type: doc.type } });
  await tell(doc, `${execution.status === 'done' ? '✅' : '⚠️'} Approved: ${doc.type}`, execution.note, admin);
  return execution;
}

module.exports = { onDecided, correctCertificate, removeDuplicateClass, sendAnnouncement, parseNewDue, STATUSES };
