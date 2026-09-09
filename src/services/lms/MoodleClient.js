const NodeCache = require('node-cache');
const { lmsConfig } = require('../../config/lms');

// Typed wrapper around the Moodle Web Services REST API.
//
//   • one process-wide instance (getMoodleClient())
//   • POST <site>/webservice/rest/server.php with wstoken + wsfunction +
//     moodlewsrestformat=json and Moodle's nested-bracket param encoding
//   • retry with exponential backoff on network / 5xx
//   • circuit breaker: after N consecutive failures, fail fast for a cool-off
//   • short read-through cache (node-cache) for the *_get_* calls, busted by
//     the matching webhook (services/lms/webhookCacheBust.js)
//   • every Moodle "exception" response is turned into a MoodleError
//
// Nothing here writes to Mongo. syncService.js composes these calls with the
// mapping models.

class MoodleError extends Error {
  constructor(message, { errorcode, debuginfo, wsfunction } = {}) {
    super(message);
    this.name = 'MoodleError';
    this.errorcode = errorcode;
    this.debuginfo = debuginfo;
    this.wsfunction = wsfunction;
  }
}

// Flatten { users: [{ username: 'a', roles: [{ roleid: 1 }] }] } into
// { 'users[0][username]': 'a', 'users[0][roles][0][roleid]': 1 } — the shape
// Moodle's REST server expects.
function flatten(params, prefix, out) {
  out = out || {};
  for (const [key, value] of Object.entries(params || {})) {
    const path = prefix ? `${prefix}[${key}]` : key;
    if (value === undefined || value === null) continue;
    if (Array.isArray(value)) {
      value.forEach((item, i) => {
        if (item !== null && typeof item === 'object') flatten(item, `${path}[${i}]`, out);
        else out[`${path}[${i}]`] = item;
      });
    } else if (typeof value === 'object') {
      flatten(value, path, out);
    } else if (typeof value === 'boolean') {
      out[path] = value ? 1 : 0;
    } else {
      out[path] = value;
    }
  }
  return out;
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

class MoodleClient {
  constructor(cfg = lmsConfig.moodle) {
    this.cfg = cfg;
    this.cache = new NodeCache({ stdTTL: cfg.cacheTtlSec, checkperiod: cfg.cacheTtlSec + 10 });
    this._failures = 0;
    this._openUntil = 0; // breaker: epoch ms until which we fail fast
  }

  get configured() {
    return !!(this.cfg.baseUrl && this.cfg.token);
  }

  _breakerOpen() {
    return Date.now() < this._openUntil;
  }

  _recordSuccess() {
    this._failures = 0;
    this._openUntil = 0;
  }

  _recordFailure() {
    this._failures += 1;
    if (this._failures >= this.cfg.breakerThreshold) {
      this._openUntil = Date.now() + this.cfg.breakerCoolOffMs;
      this._failures = 0;
    }
  }

  // Low-level call. `read` = true routes through the cache.
  async call(wsfunction, params = {}, { read = false, cacheKey } = {}) {
    if (!this.configured) {
      throw new MoodleError('Moodle Web Services are not configured (MOODLE_WS_URL / MOODLE_WS_TOKEN).', {
        errorcode: 'not_configured',
        wsfunction,
      });
    }
    if (this._breakerOpen()) {
      throw new MoodleError('Moodle is temporarily unavailable (circuit breaker open).', {
        errorcode: 'breaker_open',
        wsfunction,
      });
    }

    const key = read ? `ws:${wsfunction}:${cacheKey || JSON.stringify(params)}` : null;
    if (key) {
      const hit = this.cache.get(key);
      if (hit !== undefined) return hit;
    }

    const body = new URLSearchParams({
      wstoken: this.cfg.token,
      wsfunction,
      moodlewsrestformat: 'json',
      ...flatten(params),
    });

    const { attempts, baseDelayMs } = this.cfg.retry;
    let lastErr;
    for (let attempt = 1; attempt <= attempts; attempt += 1) {
      const ctrl = new AbortController();
      const timer = setTimeout(() => ctrl.abort(), this.cfg.timeoutMs);
      try {
        const res = await fetch(this.cfg.restUrl, {
          method: 'POST',
          headers: { 'content-type': 'application/x-www-form-urlencoded' },
          body,
          signal: ctrl.signal,
        });
        const text = await res.text();

        if (res.status >= 500) {
          lastErr = new MoodleError(`Moodle returned HTTP ${res.status}`, { errorcode: 'http_5xx', wsfunction });
          throw lastErr;
        }

        let json;
        try {
          json = text ? JSON.parse(text) : null;
        } catch (e) {
          lastErr = new MoodleError('Moodle returned a non-JSON response', { errorcode: 'bad_json', wsfunction });
          throw lastErr;
        }

        // Moodle signals errors with { exception, errorcode, message, debuginfo }
        if (json && json.exception) {
          this._recordSuccess(); // the server answered; this is a logical error, not an outage
          throw new MoodleError(json.message || 'Moodle Web Services error', {
            errorcode: json.errorcode,
            debuginfo: json.debuginfo,
            wsfunction,
          });
        }

        this._recordSuccess();
        if (key) this.cache.set(key, json);
        return json;
      } catch (err) {
        clearTimeout(timer);
        if (err instanceof MoodleError && err.errorcode && !['http_5xx', 'bad_json'].includes(err.errorcode)) {
          throw err; // logical error — do not retry
        }
        lastErr = err;
        this._recordFailure();
        if (attempt < attempts) await sleep(baseDelayMs * 2 ** (attempt - 1));
      } finally {
        clearTimeout(timer);
      }
    }
    throw new MoodleError(`Moodle unreachable after ${attempts} attempts: ${lastErr && lastErr.message}`, {
      errorcode: 'unreachable',
      wsfunction,
    });
  }

  bust(prefix) {
    for (const k of this.cache.keys()) if (k.startsWith(`ws:${prefix}`)) this.cache.del(k);
  }

  // ── health ────────────────────────────────────────────────────────────
  async siteInfo() {
    return this.call('core_webservice_get_site_info', {}, { read: true, cacheKey: 'site' });
  }

  // Uncached connection probe with a latency figure — used by the
  // /api/lms/admin/test-connection endpoint and the reconcile job.
  async ping() {
    const started = Date.now();
    try {
      const info = await this.call('core_webservice_get_site_info', {});
      return {
        ok: true,
        latencyMs: Date.now() - started,
        sitename: info.sitename,
        release: info.release,
        wwwroot: info.siteurl || this.cfg.baseUrl,
        wsUser: info.username,
        wsUserId: info.userid,
        functionCount: (info.functions || []).length,
      };
    } catch (err) {
      return {
        ok: false,
        latencyMs: Date.now() - started,
        errorcode: err.errorcode || 'error',
        message: err.message,
      };
    }
  }

  // ── users ─────────────────────────────────────────────────────────────
  async getUserByField(field, value) {
    const rows = await this.call('core_user_get_users_by_field', { field, values: [value] }, { read: true });
    return Array.isArray(rows) && rows.length ? rows[0] : null;
  }

  async createUser(user) {
    const rows = await this.call('core_user_create_users', { users: [user] });
    return Array.isArray(rows) && rows.length ? rows[0] : null;
  }

  async updateUser(user) {
    return this.call('core_user_update_users', { users: [user] });
  }

  // suspend rather than delete — keeps grade history intact
  async suspendUser(moodleUserId) {
    return this.call('core_user_update_users', { users: [{ id: moodleUserId, suspended: 1 }] });
  }

  // ── roles ─────────────────────────────────────────────────────────────
  async assignRoles(assignments) {
    // [{ roleid, userid, contextid? , contextlevel?, instanceid? }]
    return this.call('core_role_assign_roles', { assignments });
  }

  async unassignRoles(unassignments) {
    return this.call('core_role_unassign_roles', { unassignments });
  }

  // ── cohorts (batches) ────────────────────────────────────────────────
  async createCohort(cohort) {
    const rows = await this.call('core_cohort_create_cohorts', { cohorts: [cohort] });
    return Array.isArray(rows) && rows.length ? rows[0] : null;
  }

  async updateCohort(cohort) {
    return this.call('core_cohort_update_cohorts', { cohorts: [cohort] });
  }

  async addCohortMembers(members) {
    // [{ cohorttype: { type:'id', value: cohortId }, usertype: { type:'id', value: userId } }]
    return this.call('core_cohort_add_cohort_members', { members });
  }

  async deleteCohortMembers(members) {
    return this.call('core_cohort_delete_cohort_members', { members });
  }

  // ── courses & categories ────────────────────────────────────────────
  async getCourses(ids) {
    return this.call('core_course_get_courses', ids && ids.length ? { options: { ids } } : {}, { read: true });
  }

  async getCoursesByField(field, value) {
    return this.call('core_course_get_courses_by_field', { field, value }, { read: true });
  }

  async getContents(courseid) {
    return this.call('core_course_get_contents', { courseid }, { read: true, cacheKey: `contents:${courseid}` });
  }

  async createCategory(category) {
    const rows = await this.call('core_course_create_categories', { categories: [category] });
    return Array.isArray(rows) && rows.length ? rows[0] : null;
  }

  async getCategories(criteria) {
    // criteria: [{ key: 'id'|'name'|'parent'|'idnumber', value }]
    return this.call('core_course_get_categories', criteria ? { criteria } : {}, { read: true });
  }

  async createCourse(course) {
    // course: { fullname, shortname, categoryid, idnumber?, summary?, visible?,
    //           startdate?, enddate?, enablecompletion? }
    const rows = await this.call('core_course_create_courses', { courses: [course] });
    return Array.isArray(rows) && rows.length ? rows[0] : null;
  }

  async updateCourse(course) {
    return this.call('core_course_update_courses', { courses: [course] });
  }

  // ── enrolment ───────────────────────────────────────────────────────
  async enrolUsers(enrolments) {
    // [{ roleid, userid, courseid, timestart?, timeend?, suspend? }]
    return this.call('enrol_manual_enrol_users', { enrolments });
  }

  async unenrolUsers(enrolments) {
    // [{ userid, courseid }]
    return this.call('enrol_manual_unenrol_users', { enrolments });
  }

  async getEnrolledUsers(courseid) {
    return this.call('core_enrol_get_enrolled_users', { courseid }, { read: true });
  }

  async getUsersCourses(userid) {
    return this.call('core_enrol_get_users_courses', { userid }, { read: true, cacheKey: `usercourses:${userid}` });
  }

  // ── progress & grades ───────────────────────────────────────────────
  async getCourseCompletionStatus(courseid, userid) {
    return this.call('core_completion_get_course_completion_status', { courseid, userid }, { read: true });
  }

  async getActivitiesCompletionStatus(courseid, userid) {
    return this.call('core_completion_get_activities_completion_status', { courseid, userid }, { read: true });
  }

  async getUserGrades(courseid, userid) {
    return this.call('gradereport_user_get_grade_items', { courseid, userid }, { read: true });
  }

  // ── calendar ────────────────────────────────────────────────────────
  async getCalendarEvents({ from, to } = {}) {
    return this.call(
      'core_calendar_get_calendar_events',
      { options: { timestart: from, timeend: to, userevents: 1, siteevents: 1 } },
      { read: true }
    );
  }

  // ── BigBlueButton (mod_bigbluebuttonbn) ─────────────────────────────
  async bbbGetRecordings(bigbluebuttonbnid) {
    return this.call('mod_bigbluebuttonbn_get_recordings', { bigbluebuttonbnid }, { read: true });
  }
}

let _client = null;
function getMoodleClient() {
  if (!_client) _client = new MoodleClient(lmsConfig.moodle);
  return _client;
}

module.exports = { MoodleClient, MoodleError, getMoodleClient, flatten };
