# LMS pilot — one complete test class, no public domain

Run the **entire** LMS flow on the server before `learn.careerlabconsulting.com`
DNS/TLS exists and before BigBlueButton. Course → class → teacher → student →
enrol → live class → attendance → progress → CRM⇄Moodle sync → SSO → webhooks.

Nothing here changes the CRM domain, the nginx default vhost, PHP 7.4, Apache,
VICIdial, Asterisk, or the `asterisk` database. BigBlueButton is **not**
installed.

---

## What is REAL and what is MOCK

| Piece | Pilot | Real (later) |
|---|---|---|
| CRM ⇄ Moodle **user** provisioning + ID mapping | ✅ REAL | same |
| CRM ⇄ Moodle **course** shell + mapping | ✅ REAL (`core_course_create_courses`) | same |
| **Enrolment** into the Moodle course (teacher + student roles) | ✅ REAL (`enrol_manual_enrol_users`) | same |
| **SSO** login (CRM-minted JWT → Moodle session) | ✅ REAL (over the SSH tunnel) | same, over HTTPS |
| Moodle **events → CRM webhook** (HMAC, idempotent) | ✅ REAL | same |
| Course **completion / grade → CRM** projection | ✅ REAL (Moodle webhook path) | same |
| **Live-class video** | ⚠️ REAL but external: a public **Jitsi Meet** room (`meet.jit.si`, no install, no account) — or set `LMS_PILOT_MEETING=mock` for a placeholder | **BigBlueButton** on its own host |
| **Live-class attendance** | ❌ MOCK — recorded from *Start / Join / Leave* button clicks, **not** auto-derived from the meeting | auto from BBB meeting-events |
| Live-class **progress write-back** | ❌ MOCK — `end` nudges `LmsEnrolment.progressPct` to ≥ 50% (real flow: Moodle `course_completed` webhook) | REAL webhook |
| **Moodle exposure** | 127.0.0.1:8081 only, via SSH tunnel — **not on the internet** | `https://learn.careerlabconsulting.com` |

---

## Security limitation (read before you proceed)

Moodle runs over **plain HTTP on `127.0.0.1:8081`**. This is acceptable for the
pilot **only because**:

- nginx binds that vhost to **loopback** — it is **not reachable from the
  internet**, no firewall port is opened, `ufw` is untouched.
- You reach it through an **SSH tunnel** (`ssh -L 8081:127.0.0.1:8081 …`), so
  traffic between your laptop and the server is encrypted by SSH. HTTP is only
  spoken inside the server and inside the tunnel.
- The WS token, SSO secret and webhook secret never traverse a public network.

Do **not**: open port 8081 in `ufw` / the Hostinger panel, put this vhost on
`0.0.0.0`, or point a real DNS name at it. When you're ready for real use,
switch to the domain mode (`certbot`, `learn.careerlabconsulting.com`) — the
CRM `.env` just changes `MOODLE_WS_URL` and the two plugin URLs.

---

## Step 1 — back up (same as CONNECT.md §1)

```bash
mkdir -p /root/backups/$(date +%F) && cd /root/backups/$(date +%F)
tar czf clccrm-code.tgz -C /var/www clccrm --exclude 'clccrm/**/node_modules'
cp /var/www/clccrm/backend/.env clccrm-backend.env.bak
mysqldump --all-databases --single-transaction --routines --events | gzip > all-databases.sql.gz
tar czf asterisk-etc.tgz /etc/asterisk 2>/dev/null || true
tar czf nginx-etc.tgz /etc/nginx ; pm2 save
```

## Step 2 — install Moodle in PILOT mode (review, then run manually)

```bash
cd /var/www/clccrm && git pull
PILOT=1 bash deploy/moodle/setup.sh
```

**Blast radius** (identical to CONNECT.md's table, with the pilot deltas):

| Stage | Touches | Notes |
|---|---|---|
| packages | adds `php8.3-fpm` (+ exts), `redis-server` **alongside** PHP 7.4 | 7.4 / Apache / VICIdial untouched |
| DB | `CREATE DATABASE moodle` + `moodle`@`localhost`, `GRANT ON moodle.*` | **`asterisk` DB never read/altered**; MariaDB **not** restarted |
| PHP-FPM | one new pool file `/etc/php/8.3/fpm/pool.d/moodle.conf`; `restart php8.3-fpm` | `www.conf` / 7.4 tree untouched |
| nginx | new server block `listen 127.0.0.1:8081` (`nginx-learn-pilot.conf`) + `reload` | **CRM vhost `listen 80 default_server` unchanged**; different addr:port, cannot collide |
| firewall | **nothing** (loopback) | `ufw` untouched |
| cron | `moodle-cron.timer` calling `/usr/bin/php8.3` every minute | — |
| files | `/var/www/moodle`, `/var/moodledata`, `config.php` (`wwwroot=http://localhost:8081`) | new paths only |

Then, interactively (the script prints these):

```bash
# open the tunnel from your LAPTOP and keep it running:
ssh -L 8081:127.0.0.1:8081 root@200.141.5.195

# ON THE SERVER — install the Moodle DB (sets the break-glass admin password):
sudo -u www-data php8.3 /var/www/moodle/admin/cli/install_database.php \
  --agree-license --adminpass='<MOODLE_ADMIN_PASSWORD>' \
  --adminemail='ops@careerlabconsulting.com' \
  --fullname='CLC Learning' --shortname='CLC'

# install the CRM plugin tables:
sudo -u www-data php8.3 /var/www/moodle/admin/cli/upgrade.php --non-interactive
```

Open **http://localhost:8081** in your browser (tunnel up) — Moodle loads.

## Step 3 — Moodle Web Services + token

Same as `CONNECT.md` §3 (enable web services, enable **REST**, create the
`CRM integration` external service with the listed functions, a `crm.service`
system account, a token, IP-restrict the token to `127.0.0.1`). Get the
role ids:

```bash
mysql -N -e "SELECT CONCAT('\"',shortname,'\":',id) FROM moodle.mdl_role" | paste -sd,
```

## Step 4 — CRM `.env` (pilot values)

Append to `/var/www/clccrm/backend/.env` — placeholders are values you
generate on the box (`node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"`):

```ini
MOODLE_WS_URL=http://localhost:8081
MOODLE_WS_TOKEN=<WS_TOKEN>
MOODLE_ROLE_IDS={"manager":1,"coursecreator":2,"editingteacher":3,"teacher":4,"student":5}
MOODLE_DEFAULT_CATEGORY_ID=1
MOODLE_PROVISION_AUTH=manual
MOODLE_COURSE_SHORT_PREFIX=clc

MOODLE_WEBHOOK_HMAC_SECRET=<WEBHOOK_SECRET>
MOODLE_WEBHOOK_TOLERANCE_SEC=300
MOODLE_WEBHOOK_ALLOW_IPS=

MOODLE_SSO_SECRET=<SSO_SECRET>
MOODLE_SSO_TOKEN_TTL_SEC=120
MOODLE_SSO_ISSUER=clc-crm
MOODLE_SSO_AUDIENCE=moodle

LMS_PILOT_MEETING=jitsi          # or: mock
```

> `MOODLE_WS_URL=http://localhost:8081` works for the server-side WS calls
> (the CRM Node process is on the same box) **and** matches Moodle's
> `wwwroot`, so the SSO redirect the browser follows also resolves through
> your tunnel.

```bash
pm2 restart clccrm-api --update-env
```

## Step 5 — plugin config

- **local_crmbridge** (Site admin → Plugins → Local plugins → CRM bridge):
  Enable ✔ · **CRM base URL = `http://127.0.0.1:8888`** (Moodle → CRM on the
  same box, straight to Node) · Webhook HMAC secret = `<WEBHOOK_SECRET>`.
- **local_crmsso**: Shared signing key = `<SSO_SECRET>` · issuer `clc-crm` ·
  audience `moodle` · Auto-create ✔ · CRM return URL = `http://200.141.5.195/`.

Make cron flush events fast: `systemctl status moodle-cron.timer` (already
every minute).

---

## Step 6 — the test procedure

`CRM=http://200.141.5.195` · `TOKEN=<your CRM bearer, management role>` ·
`H="-H Authorization:Bearer=$TOKEN -H Content-Type:application/json"` ·
`j(){ curl -s $H "$@" | python3 -m json.tool; }`

### 6.0 Connection

```bash
j -X POST $CRM/api/lms/admin/test-connection
```
→ `ok:true`, `sitename:"CLC Learning"`, `release:"4.5…"`.

### 6.1 Seed the whole demo (course + teacher + student + enrol + class)

```bash
j -X POST $CRM/api/lms/admin/pilot/seed
```
→ `result.ids` with `crmCourseId`, `moodleCourseId`, `teacherMoodleId`,
`studentMoodleId`, `liveClassId`, **`sessionId`**, and a `steps[]` array each
`synced`. Save `SID=<sessionId>`.

**Verify mapping (step 13):**
```bash
j "$CRM/api/lms/admin/mappings?type=users"      # 2 rows, moodleUserId set, syncStatus synced
j "$CRM/api/lms/admin/mappings?type=courses"    # Demo Test Course → moodleId
j "$CRM/api/lms/admin/mappings?type=enrolments" # teacher=editingteacher, student=student, active
```
In Moodle (http://localhost:8081) → *Site admin → Courses* shows **Demo Test
Course**; open it → *Participants* → Test Teacher (Teacher), Test Student
(Student).

### 6.2 Teacher starts the class

```bash
j -X POST $CRM/api/lms/admin/pilot/liveclass/$SID/start
```
→ `status:"live"`, `roomUrl` (a CRM page) and, with `LMS_PILOT_MEETING=jitsi`,
`videoUrl` (a real `https://meet.jit.si/CLC-…` room). `LiveClass.status`
flips to `Live`.

### 6.3 Teacher login → open the room

Two ways, both fine:
- **Room page:** open the `roomUrl` from 6.2 in a browser. It shows the class,
  a **"Open the video room"** button (real Jitsi), and Join/Leave buttons.
- **SSO into Moodle as the teacher:**
  ```bash
  j -X POST $CRM/api/lms/admin/pilot/sso-link -d '{"who":"teacher"}'
  ```
  Open the `url` within 120 s (tunnel up) → lands in Moodle **logged in as
  Test Teacher**, in the course. This is the real SSO test (step 15).

### 6.4 Student joins

```bash
# via the API (records attendance):
j -X POST $CRM/api/lms/admin/pilot/liveclass/$SID/join -d '{"who":"student"}'
j -X POST $CRM/api/lms/admin/pilot/liveclass/$SID/join -d '{"who":"teacher"}'
```
…or click **Join as Student / Join as Teacher** on the room page. Each join
writes an `AttendanceRecord`.

Let a minute pass, then optionally:
```bash
j -X POST $CRM/api/lms/admin/pilot/liveclass/$SID/leave -d '{"who":"student"}'
```

### 6.5 Teacher completes the class

```bash
j -X POST $CRM/api/lms/admin/pilot/liveclass/$SID/end
```
→ `status:"completed"`, `attendees[]` with `durationMin` + `present`,
`progressWriteback.bumped[]` showing the student's `progressPct` → ≥ 50
(**MOCK** — labelled in the response).

### 6.6 Verify attendance (step 11) + progress (step 12) + everything

```bash
j "$CRM/api/lms/admin/pilot/status/$SID"
```
One snapshot:
- `liveSession.status:"completed"`, participants with durations
- `attendance[]` — Present/Late per person (also visible in the CRM **LMS →
  Attendance** tab, `sessionTopic = "Demo Live Class"`)
- `enrolments[].progressPct` — student ≥ 50
- `mapping.course` / `mapping.users` — ids + `synced`
- `recentWebhookEvents[]`

### 6.7 Verify the REAL webhook path (step 14)

Fast, no waiting:
```bash
j -X POST $CRM/api/lms/admin/webhook-selftest
```
→ `firstPost.httpCode:200` (`status:"skipped"` = received+verified+stored),
`replay.message:"duplicate"`.

Real event: in Moodle as `admin`, mark **Test Student** complete for the
course (course → *Course completion* → a self-completion criterion, then
tick it as the student, or *Reports → Course completion* override). Within
~60 s (or force `sudo -u www-data php8.3 /var/www/moodle/admin/cli/cron.php`):
```bash
j "$CRM/api/lms/admin/events"                       # newest: …course_completed, status "processed"
j "$CRM/api/lms/admin/pilot/status/$SID"            # enrolments[].completedOn set, progressPct 100
```

### 6.8 Reconcile

```bash
j -X POST $CRM/api/lms/admin/reconcile
```
→ `moodleConfigured:true`, `drift` all-zero.

---

## Summary flow

```
seed  →  teacher: start + SSO login  →  student: join (room page / API)
      →  attendance recorded  →  teacher: end  →  progress bumped (MOCK)
      →  Moodle "mark complete"  →  course_completed webhook  →  CRM projection
      →  pilot/status + mappings + events all green
```

## Teardown / reset

```bash
curl -s $H -X POST $CRM/api/lms/admin/pilot/teardown
```
Soft-removes the demo course/batch/class/attendance, suspends + unenrols the
two Moodle pilot users. The disabled CRM `Admin` rows for
`pilot.teacher@example.com` / `pilot.student@example.com` are kept — delete
them from **User Management** if you want them gone. Re-run `pilot/seed` any
time; it's idempotent.

## Going to production later (no code change)

1. Add `learn.careerlabconsulting.com` → `200.141.5.195`, then
   `DOMAIN=learn.careerlabconsulting.com bash deploy/moodle/setup.sh` (no
   `PILOT=1`) → rewrites the vhost to name-based `:80`, then
   `certbot --nginx -d learn.careerlabconsulting.com`.
2. In `config.php` set `$CFG->wwwroot='https://learn.careerlabconsulting.com'`.
3. CRM `.env`: `MOODLE_WS_URL=https://learn.careerlabconsulting.com`; plugin
   URLs unchanged (`http://127.0.0.1:8888` still works). `pm2 restart`.
4. The pilot `/api/lms/pilot/*` room page and `/admin/pilot/*` endpoints stay
   until Phase 6 (BigBlueButton) replaces the mock live class.
