# Auto live classes — no manual meeting link

Batch/course-driven live classes with an **automatically generated** meeting
room. All changes are additive: existing Batch / Course / LiveClass CRUD,
Moodle sync, VICIdial, Asterisk, PHP 7.4, Apache, MariaDB and the CRM nginx
config are untouched.

## What changed

| Area | Before | Now |
|---|---|---|
| Batch create form | had a **Meeting link** URL field | field removed; not required; `meetingLink` kept in the model as optional/legacy only |
| Batch create | — | `Batch` post-save hook auto-creates one live class + meeting room (best-effort, never blocks the save) |
| Room identifier | manual | `Course-Batch-<uniqueId>` e.g. `Full-Stack-Development-FSD-Morning-3f9c1a2b` |
| Live Classes tab | generic CRUD table | card list (`pages/Lms/LiveClasses`) — Course, Batch, Teacher, Date, Time, **UPCOMING / LIVE / ENDED** badge, **Join** button |
| Meeting URL | typed/stored as plain text, shown in the form | held server-side only (`moderatorPW`/`attendeePW`/`providerData` are `select:false`); the frontend never sees it — Join returns a **one-time redirect ticket** |
| Provider | n/a | `services/lms/meeting/` — **BigBlueButton** when `BBB_URL`+`BBB_SECRET` are set, else **Jitsi** if `LMS_MEETING_JITSI_BASE` is set, else **mock** (CRM's own role-aware room). Switches automatically, no migration |

## New model — `LmsLiveSession`

`meetingProvider` · `meetingId` · `roomName` · `scheduledStart` / `scheduledEnd`
· `actualStart` / `actualEnd` · `status` (`upcoming|live|ended|cancelled`) ·
`recordingEnabled` / `recordingStatus` / `recordingUrl` · `participants[]`
(`crmUser, role, joinedAt, lastJoinAt, leftAt, durationMin, joinCount, present,
attendanceStatus`). A mirror `LiveClass` row is also written so the old tab /
any reporting keeps working; its `joinUrl` is a role-agnostic CRM entry point,
**not** a raw meeting link.

## Lifecycle

```
UPCOMING ──(teacher: POST /liveclasses/:id/start, or first teacher Join)──▶ LIVE
LIVE ─────(teacher: POST /liveclasses/:id/end)──────────────────────────────▶ ENDED
```

- Student `Join` before the teacher starts → `409 the class has not started yet`.
- `end` finalises every participant's duration, writes `AttendanceRecord`
  rows (present ≥ 20 min, partial > 0, absent), stops recording (→ processing),
  and nudges enrolment `progressPct` for present students (**mock write-back —
  the real path is Moodle's `course_completed` webhook**).

## Teacher vs Student

Role is resolved per session: teacher if they are the batch trainer / a
management user / enrolled as `editingteacher`; student if enrolled. The card
shows **Start class** / **Join as host** / **End** / **Attendance** to teachers
and only **Join Live Class** to students. In-meeting controls are the
provider's:

- **BigBlueButton** — `role=MODERATOR` vs `role=VIEWER` in the signed join
  URL. Moderators get screen-share, participant management, mute-all,
  recording controls; viewers get video/audio (as allowed), chat, raise hand,
  leave. This is real and enforced by BBB.
- **mock / jitsi** — the mock room page lists the role-appropriate controls;
  jitsi public has no true role split (documented limitation). Both are
  replaced the moment BBB is configured.

## Join flow (URL never exposed)

```
Frontend "Join"  ──POST /api/lms/liveclasses/:id/join (bearer)──▶
  backend: resolve role, record joined_at, mint a single-use 120s ticket
  ◀── { url: "<CRM>/api/lms/live/t/<ticket>" }
Frontend window.open(url)  ──GET /api/lms/live/t/<ticket> (no bearer)──▶
  backend: redeem ticket (one-time), provider.getJoinUrl(role) ──302──▶ real meeting
```

`left_at` is captured from the BBB `logoutURL` (`/api/lms/live/left?...`) and,
as a fallback, set to `actualEnd` for anyone still "in" when the class ends.

## Config (backend/.env)

```ini
# nothing needed for the mock provider. To use BigBlueButton later:
BBB_URL=https://bbb.yourdomain.com/bigbluebutton
BBB_SECRET=<from `bbb-conf --secret`>
BBB_RECORD=true
LMS_CRM_BASE_URL=http://200.141.5.195      # for the join redirect + BBB logoutURL
# optional interim video instead of the mock room:
# LMS_MEETING_JITSI_BASE=https://meet.jit.si
```

`GET /api/lms/portal/config` → `meetingProvider` tells the UI which provider is live.

---

## End-to-end test

`CRM=http://200.141.5.195` · `TOKEN=<CRM bearer, management role>` ·
`H="-H Authorization:Bearer=$TOKEN -H Content-Type:application/json"` ·
`j(){ curl -s $H "$@" | python3 -m json.tool; }`

| # | Step | Command / action | Expect |
|---|---|---|---|
| 1 | Create course | (CRM UI **LMS → Courses**, or) `curl -s $H -XPOST $CRM/api/course/create -d '{"title":"Full Stack Development","status":"Published","mode":"Live"}'` | course `_id` |
| 2 | Create batch + assign teacher + schedule — **no meeting link asked** | `curl -s $H -XPOST $CRM/api/batch/create -d '{"name":"FSD Morning Batch","course":"Full Stack Development","trainer":"<teacher name>","status":"Running","startDate":"2026-09-10T09:00:00Z","schedule":"Morning 09:00"}'` | batch `_id` |
| 3 | Automatic meeting room | `j "$CRM/api/lms/liveclasses"` | a row with `roomName:"Full-Stack-Development-FSD-Morning-Batch-<hex>"`, `status:"UPCOMING"`, `meetingProvider` (`mock`\|`jitsi`\|`bigbluebutton`) |
| 4 | Live Classes listing (UI) | open **LMS → Live Classes** | card: course, batch, teacher, date, time, **UPCOMING** badge, **Start class** (teacher) |
| 5 | Teacher joins / starts | teacher clicks **Start class** (or `j -XPOST $CRM/api/lms/liveclasses/<id>/start`) | `status:"LIVE"`; browser opens the room (BBB moderator / mock teacher view). `LiveClass` mirror → `Live` |
| 6 | Student joins | student opens **Live Classes** → **Join Live Class** (or `j -XPOST $CRM/api/lms/liveclasses/<id>/join` → open `result.url`) | same room; BBB `VIEWER` / mock student view; **no URL to copy** |
| 7 | Screen share → student sees it | teacher shares screen in the meeting | student sees it (real in BBB; mock lists it as a control) |
| 8 | Chat both ways | student sends a message; teacher replies | delivered (BBB chat; mock shows the control) |
| 9 | Attendance captured | `j "$CRM/api/lms/liveclasses/<id>/attendance"` (or the **Attendance** button) | rows with `joinedAt`, `durationMin`, `attendanceStatus` |
| 10 | Teacher ends class | **End** (or `j -XPOST $CRM/api/lms/liveclasses/<id>/end`) | `status:"ENDED"`; `attendees[]` finalised; `progressWriteback.bumped[]` (mock) |
| 11 | Class becomes ENDED | `j "$CRM/api/lms/liveclasses"` | card badge **ENDED**, "Class ended" |
| 12 | Attendance + progress saved | `j "$CRM/api/lms/admin/pilot/status/<id>"` (or CRM **LMS → Attendance** tab) | `AttendanceRecord` rows Present/Late; enrolment `progressPct` ≥ 50 |
| 13 | Moodle + CRM intact | `j -XPOST $CRM/api/lms/admin/test-connection` · `j "$CRM/api/lms/admin/mappings?type=courses"` | connection ok; course still mapped — nothing broke |

> Fastest full run: `POST /api/lms/admin/pilot/seed` builds course + teacher +
> student + enrol + batch (→ auto live class) in one call; then use the
> `pilot/liveclass/<sessionId>/{start,join,end}` wrappers (they delegate to the
> same live-class service) — see `PILOT.md §6`.

## When BigBlueButton is ready

Set `BBB_URL` + `BBB_SECRET` + `LMS_CRM_BASE_URL`, `pm2 restart clccrm-api
--update-env`. New classes use real BBB rooms automatically; existing
`upcoming` sessions get a real room on their next start. No code change, no
data migration.

---

# v2 — full classroom system (2026-09-09)

Adds to the above: extended lifecycle, recurring classes, auto recording,
webhook-driven multi-session attendance, role-scoped recording/attendance
pages, admin settings, notifications. All additive.

## Lifecycle (LmsLiveSession.status)

```
scheduled → upcoming → starting → live → ending → ended
                                              └→ recording_processing → recording_available
```

Teacher **Start** → `starting` → BBB `create` (with `record=true`,
`autoStartRecording=true`) → `live`, `LiveRecording.status=RECORDING`.
Teacher **End** (or `meeting-ended` webhook, or auto-end past
`scheduledEnd + autoEndGraceMin`) → BBB `end` → attendance finalised →
`recording_processing` → poller / `recording-ready` webhook → `recording_available`.

## Recurring classes

Batch fields `classDays` ("Mon,Wed,Fri") + `classTime` ("10:00") +
`classDurationMin` + `startDate`/`endDate` → `recurrence.generateForBatch()`
creates one `LmsLiveSession` per class date, **each with its own room**
(`course-slug-batch-slug-class-<hex>`), capped at `LMS_MAX_AUTO_CLASSES`.
Falls back to parsing the free-text `schedule` field. `POST
/api/lms/live-classes/:id/regenerate` rebuilds future un-started sessions.

## Attendance (webhook-authoritative)

BBB `bbb-webhooks` → `POST /api/lms/webhooks/bbb` (token in `?token=` +
optional BBB checksum; idempotent per event id; logged to `LmsWebhookEvent`).
`user-joined` / `user-left` / `participant-disconnected` open/close presence
intervals on the participant. `recompute()` **merges overlapping intervals**,
sums real duration, `attendancePct = attended / scheduledDurationMin × 100`,
classifies via `LmsSetting` thresholds:
`≥ presentThresholdPct → PRESENT` (LATE if first join later than
`lateThresholdMin`), `≥ partialThresholdPct → PARTIAL`, else `ABSENT`,
manual `EXCUSED`. Reconnects continue the same participant — never marked
permanently absent. CRM join/leave calls are a fallback that merge() dedups.

## Recording states + access

`LiveRecording`: NOT_STARTED → RECORDING → PROCESSING → AVAILABLE (or FAILED,
DELETED). Access re-checked in `GET /api/lms/recordings/:id/play`:
admin = all · teacher = own classes · student = enrolled course/batch per
`LmsSetting.recordingAccess` (`enrolled|batch|course|admin-only`). Delete
keeps attendance + metadata.

## New APIs

```
GET  /api/lms/live-classes            (+ /liveclasses alias)   role-scoped list
POST /api/lms/live-classes/:id/start | /end | /join | /join/teacher | /join/student | /leave
GET  /api/lms/live-classes/:id/attendance
POST /api/lms/live-classes/:id/regenerate                       (manager)
GET  /api/lms/recordings   ·   GET /api/lms/recordings/:id/play
GET  /api/lms/student/{live-classes,recordings,attendance}
GET  /api/lms/teacher/{live-classes,recordings,attendance,attendance/export}
GET  /api/lms/admin/{attendance,attendance/export,recordings,live-monitor,live-analytics,live-settings}
POST /api/lms/admin/recordings/:id/delete   ·   POST /api/lms/admin/live-settings
POST /api/lms/webhooks/bbb                                      (pre-bearer)
```

## Env

```
LMS_BBB_WEBHOOK_TOKEN=<shared token for bbb-webhooks ?token=>
LMS_LIVE_TICK_MS=30000          # lifecycle + recording poll + notifications
LMS_MAX_AUTO_CLASSES=60
# thresholds/policies are runtime-editable via /api/lms/admin/live-settings
```

## BBB server: enable webhooks

```bash
# on the BBB host
apt-get install bbb-webhooks
# /etc/bigbluebutton/bbb-webhooks.yml  (or via bbb-conf):
#   permanentURLs:
#     - url: "https://app.<domain>/api/lms/webhooks/bbb?token=<LMS_BBB_WEBHOOK_TOKEN>"
#       getRaw: false
systemctl restart bbb-webhooks
```

## E2E test (adds to v1's 13 steps)

| # | Step | Expect |
|---|---|---|
| 14 | Create batch with `classDays=Mon,Wed,Fri`, `classTime=10:00`, 2-week window | `GET /api/lms/live-classes` shows ~6 sessions, each a distinct `roomName` |
| 15 | Teacher Start | status `LIVE`, `recordingStatus=RECORDING` (BBB) |
| 16 | 2 students join, one disconnects + rejoins | webhook opens/closes intervals |
| 17 | `GET /api/lms/live-classes/:id/attendance` | merged `totalDurationMin`, `joinCount`=2 for the reconnecting student |
| 18 | Teacher End | `recording_processing`; attendance `PRESENT/PARTIAL/ABSENT` per thresholds |
| 19 | Wait for poller / `recording-ready` webhook | `recording_available`; `LiveRecording.status=AVAILABLE` |
| 20 | Student → Recordings tab → Watch | 200 `{url}` (enrolled); a non-enrolled user → 403 |
| 21 | `GET /api/lms/student/attendance` | only own rows |
| 22 | `GET /api/lms/admin/attendance?course=&batch=&status=` + CSV/Excel export | KPIs + rows; file downloads |
| 23 | `GET /api/lms/admin/live-monitor` while a class is live | students-online count |
| 24 | Re-POST the same BBB event | `duplicate: true`, no double-count |
| 25 | Kill teacher's tab mid-class; `scheduledEnd` + grace passes | auto-end job ends it, finalises attendance |

## Rollback

```bash
# disable (data kept): jobs no-op if you also unset provider
# remove routes: git revert the lmsApi.js / app.js hunks
# drop new collections (Mongo only): lmslivesessions, liverecordings, lmssettings
# Batch.js: remove the pre/post('save') hook + the 3 schedule fields
# frontend: featureSections 'recordings'/'attendance' tabs -> restore old entries
```
Nothing to roll back on VICIdial / Asterisk / PHP / MariaDB / nginx — untouched.
