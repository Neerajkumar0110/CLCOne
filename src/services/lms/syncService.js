const mongoose = require('mongoose');
const { getMoodleClient, MoodleError } = require('./MoodleClient');
const roleMap = require('./roleMap');
const { lmsConfig } = require('../../config/lms');

// Composition layer: MoodleClient calls + the mapping models. Every function
// is idempotent and safe to re-run. When Moodle is unconfigured they no-op
// and leave the map row `pending` so jobs/lmsSyncTick.js can complete it later.
//
// These are called both directly (from CRM controllers, for the fast path)
// and from the queue consumer (for retries / bulk).

const slug = (s) =>
  String(s || '')
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[^a-z0-9]+/g, '')
    .slice(0, 90);

function usernameFor(crmUser) {
  const base = slug(crmUser.email && crmUser.email.split('@')[0]) || slug(crmUser.name) || 'user';
  return `${base}.${String(crmUser._id).slice(-6)}`;
}

// ── users ──────────────────────────────────────────────────────────────
async function provisionUser(crmUser) {
  const MoodleUserMap = mongoose.model('MoodleUserMap');
  const client = getMoodleClient();
  const idnumber = String(crmUser._id);
  const lmsRole = roleMap.lmsRoleForCrm(crmUser.role);
  const target = roleMap.LMS_TO_MOODLE[lmsRole] || roleMap.LMS_TO_MOODLE.student;

  let map = await MoodleUserMap.findOne({ crmUser: crmUser._id });
  if (!map) {
    map = await MoodleUserMap.create({
      crmUser: crmUser._id,
      crmUserIdString: idnumber,
      email: crmUser.email,
      username: usernameFor(crmUser),
      lmsRole,
      portal: target.portal,
      siteAdmin: !!target.siteAdmin,
      syncStatus: 'pending',
    });
  } else {
    map.lmsRole = lmsRole;
    map.portal = target.portal;
    map.siteAdmin = !!target.siteAdmin;
    map.email = crmUser.email;
  }

  if (!client.configured) {
    await map.save();
    return map;
  }

  try {
    // dedupe: idnumber first (our own key), then email (pre-existing accounts)
    let mUser = await client.getUserByField('idnumber', idnumber);
    if (!mUser && crmUser.email) mUser = await client.getUserByField('email', crmUser.email);

    if (!mUser) {
      // Moodle requires a password for a manual account; SSO (local_crmsso)
      // means it is never used. A random hex + fixed complexity suffix keeps
      // it non-loginable directly while satisfying any password policy.
      const randomPassword = require('crypto').randomBytes(12).toString('hex') + 'Aa1!';
      const created = await client.createUser({
        username: map.username,
        password: randomPassword,
        firstname: crmUser.name || 'CRM',
        lastname: crmUser.surname || 'User',
        email: crmUser.email,
        idnumber,
        auth: lmsConfig.moodle.provisionAuth,
      });
      mUser = created;
    } else if (String(mUser.idnumber || '') !== idnumber) {
      // link an email-matched account back to our key
      await client.updateUser({ id: mUser.id, idnumber });
    }

    map.moodleUserId = mUser.id;
    map.username = mUser.username || map.username;
    map.syncStatus = 'synced';
    map.lastSyncedAt = new Date();
    map.lastError = undefined;
    await map.save();

    await assignSystemRole(map);
    return map;
  } catch (err) {
    map.syncStatus = 'failed';
    map.lastError = err.message;
    await map.save();
    throw err;
  }
}

async function assignSystemRole(map) {
  const client = getMoodleClient();
  if (!client.configured || !map.moodleUserId) return;
  const target = roleMap.LMS_TO_MOODLE[map.lmsRole] || roleMap.LMS_TO_MOODLE.student;
  if (target.context !== 'system') return; // course/coursecat roles are set per enrolment
  await client.assignRoles([
    { roleid: roleMap.moodleRoleId(target.shortname), userid: map.moodleUserId, contextlevel: 'system', instanceid: 0 },
  ]);
}

async function suspendUser(crmUserId) {
  const MoodleUserMap = mongoose.model('MoodleUserMap');
  const client = getMoodleClient();
  const map = await MoodleUserMap.findOne({ crmUser: crmUserId });
  if (!map || !map.moodleUserId || !client.configured) return map;
  await client.suspendUser(map.moodleUserId);
  map.enabled = false;
  await map.save();
  return map;
}

// ── courses ────────────────────────────────────────────────────────────
// SOR: Moodle owns course *content*. The CRM owns the catalog entry (price,
// SEO, which batch runs it). mirrorCourse keeps a mapping row and, if the
// Moodle course does not exist yet, creates the shell (idnumber = CRM _id, so
// re-runs never duplicate it). Content is then built inside Moodle.
async function mirrorCourse(crmCourse) {
  const MoodleObjectMap = mongoose.model('MoodleObjectMap');
  const client = getMoodleClient();
  const crmIdString = String(crmCourse._id);
  const shortname =
    (crmCourse.code && slug(crmCourse.code)) ||
    `${lmsConfig.moodle.courseShortPrefix}-${crmIdString.slice(-8)}`;

  let map = await MoodleObjectMap.findOne({ kind: 'course', crmId: crmCourse._id });
  if (!map) {
    map = await MoodleObjectMap.create({
      kind: 'course',
      crmModel: 'Course',
      crmId: crmCourse._id,
      crmIdString,
      shortname,
      syncStatus: 'pending',
    });
  }
  if (!client.configured) return map;

  try {
    // already linked? (by our idnumber, or a remembered moodleId)
    let mCourse = (await client.getCoursesByField('idnumber', crmIdString))?.courses?.[0];
    if (!mCourse && map.moodleId) {
      mCourse = (await client.getCourses([map.moodleId]))?.[0];
    }

    if (!mCourse) {
      // create the shell
      const created = await client.createCourse({
        fullname: crmCourse.title || `Course ${crmIdString.slice(-6)}`,
        shortname: map.shortname || shortname,
        categoryid: lmsConfig.moodle.defaultCategoryId,
        idnumber: crmIdString,
        summary: crmCourse.description || '',
        summaryformat: 1,
        visible: crmCourse.status === 'Published' ? 1 : 0,
        startdate: crmCourse.startDate ? Math.floor(new Date(crmCourse.startDate).getTime() / 1000) : 0,
        enablecompletion: 1,
      });
      mCourse = { id: created.id, shortname: created.shortname, fullname: crmCourse.title };
    } else {
      // keep the shell's headline fields in step with the CRM catalog entry
      await client.updateCourse({
        id: mCourse.id,
        fullname: crmCourse.title || mCourse.fullname,
        summary: crmCourse.description || '',
        visible: crmCourse.status === 'Published' ? 1 : 0,
      });
    }

    map.moodleId = mCourse.id;
    map.shortname = mCourse.shortname || map.shortname;
    map.extra = { fullname: mCourse.fullname, categoryid: mCourse.categoryid ?? mCourse.category ?? lmsConfig.moodle.defaultCategoryId };
    map.syncStatus = 'synced';
    map.lastSyncedAt = new Date();
    map.lastError = undefined;
    await map.save();

    // reflect the Moodle id back onto the CRM Course doc if the field exists
    if ('moodleCourseId' in crmCourse) {
      try {
        crmCourse.moodleCourseId = mCourse.id;
        await crmCourse.save();
      } catch (e) {
        /* Course schema may not carry the field yet — non-fatal */
      }
    }

    client.bust('core_course');
    return map;
  } catch (err) {
    map.syncStatus = 'failed';
    map.lastError = err.message;
    await map.save();
    throw err;
  }
}

// Reverse direction: an enrolment / completion webhook arrived for a Moodle
// course the CRM has never mapped. Record it so the projections and admin
// views can name it. Best-effort.
async function ensureCourseMapFromMoodle(moodleId) {
  const MoodleObjectMap = mongoose.model('MoodleObjectMap');
  let map = await MoodleObjectMap.findOne({ kind: 'course', moodleId });
  if (map) return map;

  const client = getMoodleClient();
  let fullname = '';
  let shortname = '';
  let idnumber = '';
  if (client.configured) {
    try {
      const c = (await client.getCourses([moodleId]))?.[0];
      if (c) {
        fullname = c.fullname;
        shortname = c.shortname;
        idnumber = c.idnumber || '';
      }
    } catch (e) {
      /* degraded */
    }
  }

  // if the Moodle course carries our idnumber, link it to the CRM Course
  const Course = mongoose.model('Course');
  const crm = idnumber && mongoose.isValidObjectId(idnumber) ? await Course.findById(idnumber) : null;

  return MoodleObjectMap.create({
    kind: 'course',
    crmModel: 'Course',
    crmId: crm ? crm._id : new mongoose.Types.ObjectId(),
    crmIdString: crm ? String(crm._id) : `moodle-${moodleId}`,
    moodleId,
    shortname,
    extra: { fullname, unmatchedFromMoodle: !crm },
    syncStatus: 'synced',
    lastSyncedAt: new Date(),
  });
}

// ── cohorts (batches) ─────────────────────────────────────────────────
async function upsertCohort(batch) {
  const MoodleObjectMap = mongoose.model('MoodleObjectMap');
  const client = getMoodleClient();
  const crmIdString = String(batch._id);
  const idnumber = `batch-${crmIdString}`;

  let map = await MoodleObjectMap.findOne({ kind: 'cohort', crmId: batch._id });
  if (!map) {
    map = await MoodleObjectMap.create({
      kind: 'cohort',
      crmModel: 'Batch',
      crmId: batch._id,
      crmIdString,
      shortname: idnumber,
      syncStatus: 'pending',
    });
  }
  if (!client.configured) return map;

  try {
    const payload = {
      categorytype: { type: 'system', value: '' },
      name: batch.name || idnumber,
      idnumber,
      description: batch.notes || '',
    };
    if (map.moodleId) {
      await client.updateCohort({ id: map.moodleId, ...payload });
    } else {
      const created = await client.createCohort(payload);
      map.moodleId = created && created.id;
    }
    map.syncStatus = 'synced';
    map.lastSyncedAt = new Date();
    map.lastError = undefined;
    await map.save();
    return map;
  } catch (err) {
    map.syncStatus = 'failed';
    map.lastError = err.message;
    await map.save();
    throw err;
  }
}

async function setCohortMembership(batchId, { addMoodleUserIds = [], removeMoodleUserIds = [] }) {
  const MoodleObjectMap = mongoose.model('MoodleObjectMap');
  const client = getMoodleClient();
  const map = await MoodleObjectMap.findOne({ kind: 'cohort', crmId: batchId });
  if (!map || !map.moodleId || !client.configured) return;

  if (addMoodleUserIds.length) {
    await client.addCohortMembers(
      addMoodleUserIds.map((uid) => ({
        cohorttype: { type: 'id', value: map.moodleId },
        usertype: { type: 'id', value: uid },
      }))
    );
  }
  if (removeMoodleUserIds.length) {
    await client.deleteCohortMembers(
      removeMoodleUserIds.map((uid) => ({ cohortid: map.moodleId, userid: uid }))
    );
  }
}

// ── enrolment ─────────────────────────────────────────────────────────
async function enrolUser({ crmUserId, moodleCourseId, crmCourseId, batchId, source = 'admin', roleShortname = 'student', timeend } = {}) {
  const MoodleUserMap = mongoose.model('MoodleUserMap');
  const LmsEnrolment = mongoose.model('LmsEnrolment');
  const client = getMoodleClient();

  const userMap = await MoodleUserMap.findOne({ crmUser: crmUserId });
  if (!userMap) throw new MoodleError('User is not provisioned in Moodle yet.', { errorcode: 'user_unmapped' });

  let enr = await LmsEnrolment.findOne({ crmUser: crmUserId, moodleCourseId });
  if (!enr) {
    enr = await LmsEnrolment.create({
      crmUser: crmUserId,
      moodleUserId: userMap.moodleUserId,
      crmCourse: crmCourseId,
      moodleCourseId,
      batch: batchId,
      roleShortname,
      source,
      timeend,
      status: 'pending',
      syncStatus: 'pending',
    });
  } else {
    enr.source = source;
    enr.batch = batchId || enr.batch;
    enr.roleShortname = roleShortname;
    enr.timeend = timeend || enr.timeend;
  }

  if (!client.configured || !userMap.moodleUserId) {
    await enr.save();
    return enr;
  }

  try {
    await client.enrolUsers([
      {
        roleid: roleMap.moodleRoleId(roleShortname),
        userid: userMap.moodleUserId,
        courseid: moodleCourseId,
        timestart: Math.floor(Date.now() / 1000),
        timeend: timeend ? Math.floor(new Date(timeend).getTime() / 1000) : 0,
      },
    ]);
    enr.status = 'active';
    enr.timestart = new Date();
    enr.syncStatus = 'synced';
    enr.lastSyncedAt = new Date();
    enr.lastError = undefined;
    await enr.save();
    client.bust(`usercourses:${userMap.moodleUserId}`);
    return enr;
  } catch (err) {
    enr.syncStatus = 'failed';
    enr.lastError = err.message;
    await enr.save();
    throw err;
  }
}

async function unenrolUser({ crmUserId, moodleCourseId } = {}) {
  const MoodleUserMap = mongoose.model('MoodleUserMap');
  const LmsEnrolment = mongoose.model('LmsEnrolment');
  const client = getMoodleClient();

  const userMap = await MoodleUserMap.findOne({ crmUser: crmUserId });
  const enr = await LmsEnrolment.findOne({ crmUser: crmUserId, moodleCourseId });
  if (!enr) return null;

  if (client.configured && userMap && userMap.moodleUserId) {
    await client.unenrolUsers([{ userid: userMap.moodleUserId, courseid: moodleCourseId }]);
    client.bust(`usercourses:${userMap.moodleUserId}`);
  }
  enr.status = 'ended';
  enr.syncStatus = client.configured ? 'synced' : 'pending';
  enr.lastSyncedAt = new Date();
  await enr.save();
  return enr;
}

// ── reconciliation (nightly) ─────────────────────────────────────────
// Phase 1 skeleton: report unmapped or stale rows into the audit log. The
// full user/enrolment/completion diff is fleshed out in Phase 8.
async function reconcile() {
  const MoodleUserMap = mongoose.model('MoodleUserMap');
  const LmsEnrolment = mongoose.model('LmsEnrolment');
  const staleBefore = new Date(Date.now() - 24 * 3600 * 1000);

  const [usersPending, usersFailed, enrolPending, enrolFailed] = await Promise.all([
    MoodleUserMap.countDocuments({ syncStatus: 'pending' }),
    MoodleUserMap.countDocuments({ syncStatus: 'failed' }),
    LmsEnrolment.countDocuments({ syncStatus: 'pending' }),
    LmsEnrolment.countDocuments({ syncStatus: 'failed' }),
  ]);
  const staleUsers = await MoodleUserMap.countDocuments({
    syncStatus: 'synced',
    lastSyncedAt: { $lt: staleBefore },
  });

  return {
    at: new Date(),
    moodleConfigured: getMoodleClient().configured,
    drift: { usersPending, usersFailed, enrolPending, enrolFailed, staleUsers },
  };
}

module.exports = {
  provisionUser,
  assignSystemRole,
  suspendUser,
  mirrorCourse,
  ensureCourseMapFromMoodle,
  upsertCohort,
  setCohortMembership,
  enrolUser,
  unenrolUser,
  reconcile,
};
