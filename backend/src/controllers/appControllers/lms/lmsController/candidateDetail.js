const mongoose = require('mongoose');
const { LMS_FULL_ACCESS_ROLES } = require('../../../../config/roles');

// GET /api/lms/students/:id/detail — everything about one candidate for the
// Candidates tab's click-a-row modal: roster record, joining, KYC (with the
// uploaded documents), fee plan + every installment, the batch they're in
// and when they got it (plus every batch change), attendance, certificates,
// status changes and their CRM login. Management only — KYC documents are
// personal data.
const rxEq = (s) => new RegExp(`^${String(s || '').replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}$`, 'i');

async function candidateDetail(req, res) {
  if (!LMS_FULL_ACCESS_ROLES.includes(req.admin.role)) {
    return res.status(403).json({ success: false, result: null, message: 'Management role required.' });
  }
  const Student = mongoose.model('Student');
  let s = null;
  if (req.params.id) {
    if (!mongoose.isValidObjectId(req.params.id)) {
      return res.status(400).json({ success: false, result: null, message: 'Invalid id.' });
    }
    s = await Student.findOne({ _id: req.params.id }).lean();
  } else if (req.query.email) {
    // GET /api/lms/students/detail-by-email?email= — User Management's
    // Candidate rows only know the login's email, not the roster row id.
    s = await Student.findOne({ email: rxEq(String(req.query.email).trim()), removed: false }).sort({ created: -1 }).lean();
  }
  if (!s) return res.status(404).json({ success: false, result: null, message: 'Candidate not found.' });

  const Admin = mongoose.model('Admin');
  const Batch = mongoose.model('Batch');
  const PaymentRequest = mongoose.model('PaymentRequest');
  const PaymentKyc = mongoose.model('PaymentKyc');
  const AttendanceRecord = mongoose.model('AttendanceRecord');
  const Certificate = mongoose.model('Certificate');
  const AuditLog = mongoose.model('AuditLog');
  const LoginActivity = mongoose.model('LoginActivity');

  // Payments: the linked request's whole EMI plan, plus anything else sent
  // to this email.
  const linked = s.paymentRequest ? await PaymentRequest.findById(s.paymentRequest).select('planGroupId').lean() : null;
  const payOr = [{ studentEmail: rxEq(s.email) }];
  if (linked && linked.planGroupId) payOr.push({ planGroupId: linked.planGroupId });
  if (s.paymentRequest) payOr.push({ _id: s.paymentRequest });

  const [account, batch, payments, attendance, certificates, statusChanges] = await Promise.all([
    Admin.findOne({ email: rxEq(s.email), removed: false })
      .select('created lastSeenAt enabled rosterHold rosterHoldReason financeHold financeHoldAt')
      .lean(),
    s.batch ? Batch.findOne({ name: s.batch, removed: false }).lean() : null,
    PaymentRequest.find({ removed: false, $or: payOr }).sort({ created: 1 }).lean(),
    AttendanceRecord.find({ removed: false, student: rxEq(s.name) }).select('batch date status durationMin markedBy').sort({ date: 1 }).lean(),
    Certificate.find({ removed: false, student: rxEq(s.name) }).select('certificateId title type course issuedOn grade status').lean(),
    AuditLog.find({ module: 'student', action: 'status.change', entityId: s._id }).sort({ created: 1 }).lean(),
  ]);

  const kyc = payments.length
    ? await PaymentKyc.findOne({ removed: false, paymentRequest: { $in: payments.map((p) => p._id) } }).sort({ created: -1 }).lean()
    : null;
  const lastLogin = account
    ? await LoginActivity.findOne({ removed: false, admin: account._id }).sort({ loginAt: -1 }).select('loginAt').lean()
    : null;

  // When did they get the current batch? Recorded from now on
  // (Student.batchAssignedAt); older rows fall back to their first
  // attendance row in that batch, then the roster row's own creation.
  let batchAssigned = null;
  if (s.batch) {
    if (s.batchAssignedAt) batchAssigned = { at: s.batchAssignedAt, approx: false };
    else {
      const firstInBatch = attendance.find((a) => a.batch === s.batch);
      batchAssigned = firstInBatch
        ? { at: firstInBatch.date, approx: true, basis: 'first class attended/marked in this batch' }
        : { at: s.created, approx: true, basis: 'candidate record created' };
    }
  }

  const liveClasses = await buildLiveClassJoinLog(s, account);

  const att = { total: attendance.length, byStatus: {}, minutes: 0, first: null, last: null };
  attendance.forEach((a) => {
    att.byStatus[a.status] = (att.byStatus[a.status] || 0) + 1;
    att.minutes += a.durationMin || 0;
  });
  if (attendance.length) {
    att.first = attendance[0].date;
    att.last = attendance[attendance.length - 1].date;
  }
  const attended = (att.byStatus.Present || 0) + (att.byStatus.Late || 0) + (att.byStatus['Left Early'] || 0);
  att.pct = att.total ? Math.round((attended / att.total) * 100) : null;

  const paid = payments.filter((p) => p.status === 'paid');
  const planTotal = payments.reduce((m, p) => Math.max(m, p.planTotal || 0), 0) || null;

  return res.status(200).json({
    success: true,
    result: {
      student: s,
      joining: {
        enrolledOn: s.enrolledOn || null,
        recordCreated: s.created,
        firstPaymentAt: paid.length ? paid[0].paidAt || paid[0].created : null,
        kycSubmittedAt: (payments.find((p) => p.kycSubmittedAt) || {}).kycSubmittedAt || (kyc && kyc.created) || null,
        accountCreated: account ? account.created : null,
      },
      account: account
        ? {
            _id: account._id,
            created: account.created,
            lastSeenAt: account.lastSeenAt || null,
            lastLoginAt: lastLogin ? lastLogin.loginAt : null,
            enabled: account.enabled,
            rosterHold: !!account.rosterHold,
            rosterHoldReason: account.rosterHoldReason || null,
            financeHold: !!account.financeHold,
            financeHoldAt: account.financeHoldAt || null,
          }
        : null,
      kyc,
      payments: payments.map((p) => ({
        _id: p._id,
        course: p.course,
        amount: p.amount,
        status: p.status,
        installmentNo: p.installmentNo,
        installmentCount: p.installmentCount,
        planTotal: p.planTotal || null,
        created: p.created,
        paidAt: p.paidAt || null,
        dueAt: p.dueAt || null,
        nextInstallmentDueAt: p.nextInstallmentDueAt || null,
        razorpayPaymentId: p.razorpayPaymentId || null,
        razorpayShortUrl: p.razorpayShortUrl || null,
        kycSubmitted: !!p.kycSubmitted,
      })),
      paymentSummary: {
        planTotal,
        paidTotal: paid.reduce((t, p) => t + (p.amount || 0), 0),
        paidCount: paid.length,
        installmentCount: payments.reduce((m, p) => Math.max(m, p.installmentCount || 1), 0) || null,
      },
      batch: batch
        ? {
            name: batch.name,
            code: batch.code,
            course: batch.course,
            mode: batch.mode,
            trainer: batch.trainer,
            coordinator: batch.coordinator,
            startDate: batch.startDate,
            endDate: batch.endDate,
            schedule: batch.schedule,
            classDays: batch.classDays,
            classTime: batch.classTime,
            endTime: batch.endTime,
            status: batch.status,
            enrolled: batch.enrolled,
            seats: batch.seats,
          }
        : null,
      batchAssigned,
      batchHistory: s.batchHistory || [],
      liveClasses,
      attendance: att,
      certificates,
      statusChanges: statusChanges.map((a) => ({
        at: a.created,
        from: a.after && a.after.from,
        to: a.after && a.after.to,
        by: a.performedByName || null,
      })),
    },
    message: 'ok',
  });
}

// Per-class join story for the last 30 classes that have started:
//   Join clicked?       → LmsJoinAttempt step 'join' (or, for classes from
//                         before that log existed, the participant's CRM
//                         presence intervals)
//   Refused, and why?   → failed 'join'/'ticket' attempts
//   Sent on to BBB?     → successful 'ticket' attempt
//   Actually inside?    → participant.bbbFirstSeenAt (live tick, ~30s polls)
// `tracked` is false for classes before the join log existed — only "Join
// clicked / not clicked" is knowable for those.
async function buildLiveClassJoinLog(s, account) {
  const LmsLiveSession = mongoose.model('LmsLiveSession');
  const LmsJoinAttempt = mongoose.model('LmsJoinAttempt');
  const now = new Date();

  const or = [];
  if (s.batch) or.push({ batchName: s.batch });
  if (account) or.push({ 'participants.crmUser': account._id });
  if (!or.length) return [];

  const sessions = await LmsLiveSession.find({
    removed: { $ne: true },
    status: { $ne: 'cancelled' },
    scheduledStart: { $lte: now },
    $or: or,
  })
    .sort({ scheduledStart: -1 })
    .limit(30)
    .select('title batchName teacherName status scheduledStart scheduledEnd actualStart actualEnd participants')
    .lean();

  const [attempts, firstLogged] = await Promise.all([
    account && sessions.length
      ? LmsJoinAttempt.find({ crmUser: account._id, session: { $in: sessions.map((x) => x._id) } }).sort({ at: 1 }).lean()
      : [],
    LmsJoinAttempt.findOne({}).sort({ at: 1 }).select('at').lean(),
  ]);
  const trackingSince = firstLogged ? firstLogged.at : null;

  return sessions.map((x) => {
    const p = account ? (x.participants || []).find((pp) => String(pp.crmUser) === String(account._id)) : null;
    const mine = attempts.filter((a) => String(a.session) === String(x._id));
    const joinOk = mine.filter((a) => a.step === 'join' && a.ok);
    const ticketOk = mine.filter((a) => a.step === 'ticket' && a.ok);
    const failed = mine.filter((a) => !a.ok);
    const crmIntervals = (p && p.sessions) || [];
    const tracked = !!(trackingSince && x.scheduledEnd && new Date(x.scheduledEnd) >= trackingSince);
    const clickedJoin = joinOk.length > 0 || crmIntervals.length > 0;
    const inBbb = !!(p && p.bbbFirstSeenAt);

    let verdict;
    let tone;
    if (!x.actualStart) {
      verdict = 'Class never started';
      tone = 'gray';
    } else if (inBbb) {
      verdict = 'Joined the class in BBB';
      tone = 'green';
    } else if (tracked && ticketOk.length) {
      verdict = "Sent to BBB but never appeared inside — the BBB page didn't load on their side (network / browser)";
      tone = 'red';
    } else if (failed.length && !joinOk.length) {
      verdict = `Join refused: ${failed[failed.length - 1].error || 'error'}`;
      tone = 'red';
    } else if (clickedJoin) {
      verdict = tracked
        ? 'Clicked Join but never reached BBB'
        : 'Clicked Join in the CRM (BBB entry not tracked for classes before this log)';
      tone = tracked ? 'red' : 'yellow';
    } else {
      verdict = 'Did not try to join';
      tone = 'gray';
    }

    return {
      _id: x._id,
      title: x.title,
      batchName: x.batchName,
      teacherName: x.teacherName,
      status: x.status,
      scheduledStart: x.scheduledStart,
      scheduledEnd: x.scheduledEnd,
      actualStart: x.actualStart || null,
      actualEnd: x.actualEnd || null,
      tracked,
      verdict,
      tone,
      clickedJoin,
      firstJoinClickAt: (joinOk[0] && joinOk[0].at) || (p && p.firstJoinAt) || null,
      sentToBbbAt: ticketOk[0] ? ticketOk[0].at : null,
      bbbFirstSeenAt: (p && p.bbbFirstSeenAt) || null,
      bbbLastSeenAt: (p && p.bbbLastSeenAt) || null,
      durationMin: (p && p.totalDurationMin) || 0,
      attendanceStatus: (p && p.attendanceStatus) || 'ABSENT',
      attempts: mine.map((a) => ({ at: a.at, step: a.step, via: a.via, ok: a.ok, error: a.error || null, userAgent: a.userAgent || null, ip: a.ip || null })),
    };
  });
}

module.exports = { candidateDetail };
