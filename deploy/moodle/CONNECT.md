# Deliverable 3 — Connect the CRM to Moodle

End-to-end runbook for wiring the existing CLC CRM to a Moodle site:

```
CRM student → Moodle user provisioning → Moodle enrolment → course access
           → CRM ⇄ Moodle sync → CRM SSO → Moodle events/webhooks → CRM
```

Nothing here changes the CRM, VICIdial, Asterisk or telephony code. The only
new moving parts are the `/api/lms/*` routes (already merged, inert until
`MOODLE_WS_URL` is set) and a Moodle server.

> **Scope decision (2026-09-09):** the only new DNS record is
> **`learn.careerlabconsulting.com` → `200.141.5.195`**. The CRM keeps its
> current setup unchanged — it stays reachable at **`http://200.141.5.195`**
> (bare IP, HTTP), its nginx vhost, Node backend, VICIdial and Asterisk are
> **not** modified. Consequences: Moodle itself is HTTPS on `learn.…`; the
> Moodle→CRM webhook and the SSO return URL point at `http://200.141.5.195`
> (the webhook is still HMAC-signed, so integrity/authenticity hold, but the
> body travels unencrypted on that hop — acceptable for the pilot, revisit
> when the CRM gets TLS).

> **Secrets:** every `<PLACEHOLDER>` below is a value you generate on the
> server and paste into a file — never into chat, a commit, or a ticket.
> Generate one with:
> `node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"`

---

## 0. Verify before touching the server

Run these **on the VPS** (`ssh root@200.141.5.195`). They only read state.

```bash
# OS + resources
lsb_release -a; uname -r
free -h                      # need ~1.5–2 GB *available* for Moodle+PHP+Redis
df -h /                      # need ~10 GB+ free for moodledata + backups
nproc; uptime                # load average headroom for Asterisk

# What already listens / runs
ss -ltnp | grep -E ':80|:443|:3306|:8888|:6379' || true
systemctl --type=service --state=running | grep -Ei 'nginx|php|mysql|maria|asterisk|redis|pm2|clccrm' || true
pm2 ls 2>/dev/null || true

# Existing SQL server? (VICIdial ships one) — do NOT reinstall it
mysql --version 2>/dev/null || echo "no local mysql client"
mysql -N -e "SELECT VERSION(); SHOW DATABASES;" 2>/dev/null || echo "no local SQL / needs creds"

# Existing web vhosts (don't clobber the CRM one)
ls -la /etc/nginx/sites-enabled/
nginx -T 2>/dev/null | grep -E 'server_name|root ' | head -40

# Is there already a domain + TLS on this box?
curl -sI http://200.141.5.195/ | head -5
```

### Decision: can Moodle safely be co-located here?

| Finding | Safe to proceed | Action |
|---|---|---|
| `MemAvailable` ≥ 1.5 GB and ≥ 10 GB disk free | ✅ | continue |
| `MemAvailable` < 1.5 GB | ⚠️ | add swap (`fallocate -l 2G /swapfile …`) or resize the VPS first |
| A MySQL/MariaDB already runs (VICIdial's `asterisk` DB) | ✅ with care | `setup.sh` **auto-detects** it, installs **no** DB server, creates only the `moodle` schema (`GRANT ON moodle.*`), and does **not** restart it — `asterisk` is never touched |
| **System PHP is 7.4** (VICIdial via Apache mod_php) | ✅ with care | Moodle 4.5 needs PHP 8.1–8.3. `setup.sh` installs a **dedicated `php8.3-fpm` alongside** 7.4; 7.4, `libapache2-mod-php7.4` and Apache are untouched. Every Moodle CLI command uses the versioned `php8.3` binary |
| Apache on `127.0.0.1:8090` (VICIdial UI, proxied by nginx `/vicidial/` etc.) | ✅ | Moodle is served by a **separate name-based nginx vhost** + `php8.3-fpm`; the CRM vhost keeps `default_server` and all its proxies |
| Asterisk service present | ✅ | `setup.sh` caps the Moodle PHP-FPM pool (`pm.max_children=6`, `memory_limit=256M`); nothing touches the Asterisk service |
| `/etc/nginx/sites-enabled/moodle` already exists | ⚠️ | re-run needs `FORCE=1` |
| **2 vCPU only** | ⚠️ pilot-OK | idle now (load ~0.05). Fine for the connection tests + light use. Under concurrent BBB live classes this is the bottleneck — plan to move Moodle to its own host before scale (Blueprint §12). Keep `PHP_POOL_MAX` low |
| No HTTPS / domain on the box yet (nginx `:80` only) | ⚠️ prerequisite | add `learn.careerlabconsulting.com` -> `200.141.5.195`, then `certbot` for that name only. The CRM stays on `http://200.141.5.195` unchanged |
| No spare CPU (load ≈ nproc, sustained) | ❌ | put Moodle on its own small VPS; point `MOODLE_WS_URL` at it — no CRM code changes |

**This box (verified 2026-09-09):** 7.8 GB RAM / 6.7 GB free, 88 GB disk free,
2 vCPU idle, MariaDB 10.6.23 (`asterisk` DB = VICIdial), PHP 7.4 + Apache
(VICIdial UI), nginx `:80` only, ufw allows 443. → **Safe to proceed for the
pilot once a domain + TLS is in place.**

`setup.sh` runs the resource/DB/PHP/Apache/Asterisk checks as a **pre-flight**
and refuses to continue on a hard warning unless you re-run with `FORCE=1`.

---

## 1. Back up first (before any change)

```bash
mkdir -p /root/backups/$(date +%F)
cd /root/backups/$(date +%F)

# CRM code + env (env is git-ignored)
tar czf clccrm-code.tgz -C /var/www clccrm --exclude clccrm/**/node_modules
cp /var/www/clccrm/backend/.env clccrm-backend.env.bak

# Every local SQL database (VICIdial/Asterisk included) — safe, read-only dump
which mysqldump && mysqldump --all-databases --single-transaction --routines --events \
  2>/dev/null | gzip > all-databases.sql.gz || echo "no local SQL to dump"

# Asterisk + VICIdial config
tar czf asterisk-etc.tgz /etc/asterisk 2>/dev/null || true
[ -d /etc/vicidial ] && tar czf vicidial-etc.tgz /etc/vicidial || true

# nginx + pm2
tar czf nginx-etc.tgz /etc/nginx
pm2 save && cp ~/.pm2/dump.pm2 pm2-dump.bak 2>/dev/null || true

ls -lah
```

MongoDB is on Atlas (remote) — snapshot it from the Atlas UI (**Clusters →
… → Back Up Now**) or rely on Atlas continuous backup.

---

## 2. Install Moodle

```bash
cd /var/www/clccrm && git pull        # get the Deliverable 2–3 files
DOMAIN=learn.careerlabconsulting.com bash deploy/moodle/setup.sh
```

**What each stage changes** (see `deploy/moodle/setup.sh`) — this VPS runs
PHP 7.4 (VICIdial/Apache) and MariaDB 10.6 with the `asterisk` DB, so:

| Stage | Touches | Reversible by |
|---|---|---|
| pre-flight | nothing (reads only) — reports PHP 7.4, Apache, MariaDB, Asterisk and confirms none are touched | — |
| packages | installs a **dedicated `php8.3-*` (FPM)** *alongside* PHP 7.4 (7.4 untouched), `redis-server`, `php8.3-redis`; **no `mariadb-server`** (one is already running); `nginx` already present → no-op | `apt-get remove 'php8.3-*' redis-server` |
| PHP-FPM pool | one new file `/etc/php/8.3/fpm/pool.d/moodle.conf` (custom socket `php8.3-fpm-moodle.sock`); `systemctl restart php8.3-fpm`. **Does not touch `www.conf` or the php7.4 tree.** | delete the file, restart |
| database | `CREATE DATABASE moodle` + `moodle`@`localhost`, `GRANT` scoped to `moodle.*` only — **`asterisk` and every other schema are never read or altered**; **no my.cnf, no MariaDB restart** (existing server) | `DROP DATABASE moodle; DROP USER 'moodle'@'localhost';` |
| Moodle source | `git clone` (GitHub mirror) into `/var/www/moodle`; `/var/moodledata` created | `rm -rf /var/www/moodle /var/moodledata` |
| config.php | writes `/var/www/moodle/config.php` (driver auto-detected → `mariadb`) | delete the file |
| plugins | copies `local_crmbridge` + `local_crmsso` into `/var/www/moodle/local/` | `rm -rf /var/www/moodle/local/crm*` |
| nginx vhost | new **name-based** `/etc/nginx/sites-available/moodle` (`server_name learn.<domain>`, **not** `default_server`) + symlink; `nginx -t && systemctl reload nginx`. The CRM vhost (`server_name _`, the VICIdial + `/api` proxies) is untouched | `rm` the two files, reload |
| cron | `moodle-cron.timer`/`.service` calling **`/usr/bin/php8.3`** (bare `php` is 7.4 here) every minute | `systemctl disable --now moodle-cron.timer` |
| firewall | `ufw allow 443/tcp` (already allowed on this box → no-op) | `ufw delete allow 443/tcp` |

It does **not** run the Moodle installer or get a cert — you do those next,
interactively. **Use the versioned `php8.3` binary** — bare `php` on this box
is 7.4 and Moodle 4.5 will not run on it:

```bash
# 2a. TLS (needs the learn.<domain> A-record pointing at this box)
certbot --nginx -d learn.careerlabconsulting.com

# 2b. Install the DB — THIS sets the break-glass admin password
sudo -u www-data php8.3 /var/www/moodle/admin/cli/install_database.php \
  --agree-license \
  --adminpass='<MOODLE_ADMIN_PASSWORD>' \
  --adminemail='ops@<yourdomain>' \
  --fullname='CLC Learning' --shortname='CLC'

# 2c. Install the two CRM plugins' DB tables
sudo -u www-data php8.3 /var/www/moodle/admin/cli/upgrade.php --non-interactive
```

The `admin` account is for emergencies only — real users arrive via SSO. Put
MFA on it (`Site admin → Plugins → Authentication → Manage → ...` / an OTP
plugin).

---

## 3. Moodle Web Service configuration

*Site administration → Server → Web services.*

1. **Overview** → *Enable web services* = Yes.
2. **Manage protocols** → enable **REST**. (Leave XML-RPC/SOAP off.)
3. **External services** → **Add**:
   - Name: `CRM integration` · Short name: `crm_integration`
   - *Enabled* ✔ · *Authorised users only* ✔ · *Can download files* ✔ · *Can upload files* ✔
4. **Functions** (Add functions to `CRM integration`) — the Deliverable-3 set:

   | Purpose | Function |
   |---|---|
   | health | `core_webservice_get_site_info` |
   | users | `core_user_get_users_by_field`, `core_user_create_users`, `core_user_update_users` |
   | roles | `core_role_assign_roles`, `core_role_unassign_roles` |
   | cohorts (batches) | `core_cohort_create_cohorts`, `core_cohort_update_cohorts`, `core_cohort_add_cohort_members`, `core_cohort_delete_cohort_members` |
   | courses | `core_course_get_courses`, `core_course_get_courses_by_field`, `core_course_get_categories`, `core_course_create_categories`, `core_course_create_courses`, `core_course_update_courses`, `core_course_get_contents` |
   | enrolment | `enrol_manual_enrol_users`, `enrol_manual_unenrol_users`, `core_enrol_get_enrolled_users`, `core_enrol_get_users_courses` |
   | progress / grades | `core_completion_get_course_completion_status`, `core_completion_get_activities_completion_status`, `gradereport_user_get_grade_items` |
   | calendar | `core_calendar_get_calendar_events` |
   | live classes (Phase 6) | `mod_bigbluebuttonbn_get_recordings` |

5. **Create the WS system account** — a normal Moodle user, e.g.
   `crm.service@<yourdomain>`, auth = manual. Give it a site-level role that
   holds the capabilities behind the functions above (simplest: assign
   **Manager** at *System* context; tighter: clone Manager and trim).
   *External services → CRM integration → Authorised users* → add it.
6. **Manage tokens** → **Create token**: user = `crm.service`, service =
   `CRM integration`. Copy the token → this is `<MOODLE_WS_TOKEN>`.
7. **Lock it down**: on the token set *IP restriction* = the CRM server IP,
   and add an OS firewall rule so `learn.<domain>:443` only accepts the CRM
   box for `/webservice/*` (or rely on the token IP restriction + HMAC).

### Numeric role ids (for `MOODLE_ROLE_IDS`)

```bash
mysql -N -e "SELECT CONCAT('\"',shortname,'\":',id) FROM moodle.mdl_role" | paste -sd,
# → manager:1,coursecreator:2,editingteacher:3,teacher:4,student:5,...
```

Wrap in `{ }` for the env var. Add the custom `counsellor` / `contentmanager`
roles later (Blueprint §07) and re-run this.

---

## 4. CRM `.env` variables

Append to `/var/www/clccrm/backend/.env` (never commit it):

```ini
# ── CRM → Moodle Web Services ─────────────────────────────
MOODLE_WS_URL=https://learn.careerlabconsulting.com
MOODLE_WS_TOKEN=<MOODLE_WS_TOKEN>
MOODLE_ROLE_IDS={"manager":1,"coursecreator":2,"editingteacher":3,"teacher":4,"student":5}
MOODLE_DEFAULT_CATEGORY_ID=1
MOODLE_PROVISION_AUTH=manual
MOODLE_COURSE_SHORT_PREFIX=clc

# ── Moodle (local_crmbridge) → CRM webhook ────────────────
MOODLE_WEBHOOK_HMAC_SECRET=<WEBHOOK_SECRET>
MOODLE_WEBHOOK_KEY=<WEBHOOK_KEY_optional>
MOODLE_WEBHOOK_TOLERANCE_SEC=300
# Co-located pilot: Moodle POSTs from this same box through nginx, so the
# source IP the CRM sees is 127.0.0.1 / the box IP. Leave the allow-list
# BLANK — the HMAC signature is the real gate. Set it once Moodle moves to
# its own host.
MOODLE_WEBHOOK_ALLOW_IPS=

# ── CRM → Moodle SSO (local_crmsso) ──────────────────────
MOODLE_SSO_SECRET=<SSO_SECRET>
MOODLE_SSO_TOKEN_TTL_SEC=60
MOODLE_SSO_ISSUER=clc-crm
MOODLE_SSO_AUDIENCE=moodle

# ── BigBlueButton (Phase 6 — leave blank for now) ────────
BBB_URL=
BBB_SECRET=
```

The CRM is reached at its current address for these hops:
`local_crmbridge` **CRM base URL** = `http://200.141.5.195` ·
`local_crmsso` **CRM return URL** = `http://200.141.5.195/logout`.

Then restart the API **without dropping calls**:

```bash
pm2 restart clccrm-api --update-env
pm2 logs clccrm-api --lines 20      # expect: no "[lms] sync tick idle" line anymore
```

(On Vercel, set the same vars in the project's Environment Variables and
redeploy. The webhook + portal routes work on serverless; the background
sync worker only runs on the PM2/VPS process — which is fine, Moodle is on
the VPS.)

---

## 5. `local_crmbridge` configuration

*Site administration → Plugins → Local plugins → CRM bridge:*

| Setting | Value |
|---|---|
| Enable event delivery | ✔ |
| CRM base URL | `http://200.141.5.195` (the CRM's current address, **no** trailing slash) |
| Webhook HMAC secret | `<WEBHOOK_SECRET>` — same as `MOODLE_WEBHOOK_HMAC_SECRET` |
| API key | `<WEBHOOK_KEY_optional>` — same as `MOODLE_WEBHOOK_KEY`, or leave both blank |
| HTTP timeout | `10` |

Events sent: `user_enrolment_created` / `_deleted`, `course_completed`,
`quiz attempt_submitted`, `assign submission_graded`, `badge_awarded`,
`customcert certificate_issued`. Delivery is via an adhoc task + a 5-min
retry task, with a local delivery log / dead-letter at
`/local/crmbridge/manage.php`.

Make Moodle cron run often so events flush promptly:
```bash
# setup.sh already installs this — confirm:
systemctl status moodle-cron.timer
```

---

## 6. `local_crmsso` configuration

*Site administration → Plugins → Local plugins → CRM SSO:*

| Setting | Value |
|---|---|
| Shared signing key | `<SSO_SECRET>` — same as `MOODLE_SSO_SECRET` |
| Expected issuer | `clc-crm` |
| Expected audience | `moodle` |
| Auto-create unknown users | ✔ (safety net; the CRM normally provisions first) |
| CRM return URL | `http://200.141.5.195/logout` |

Flow: CRM `GET /api/lms/sso/login-url` → mints a 60-second, single-use HS256
JWT (`sub` = CRM user `_id`) → browser hits
`https://learn.<domain>/local/crmsso/login.php?token=…` → plugin verifies
signature + expiry + one-time `jti`, finds the Moodle user by `idnumber`,
calls `complete_user_login()`, redirects to `wantsurl`.

---

## Mapping model (how the two systems stay joined)

| Thing | CRM side | Moodle side | Join key | Where |
|---|---|---|---|---|
| **User** | `Admin._id` | `user.idnumber` = that `_id`; `user.id` numeric | `idnumber` first, `email` fallback, **never create if a map row exists** | `MoodleUserMap` |
| **Course** | `Course._id` | `course.idnumber` = that `_id`; `course.id` numeric; shortname `clc-<id8>` or the CRM course `code` | `idnumber` | `MoodleObjectMap {kind:'course'}` |
| **Batch** | `Batch._id` | `cohort.idnumber` = `batch-<_id>`; cohort-sync enrolment | `idnumber` | `MoodleObjectMap {kind:'cohort'}` |
| **Enrolment** | decision + `LmsEnrolment` row | `user_enrolments` via `enrol_manual` | `(crmUser, moodleCourseId)` unique | `LmsEnrolment` |
| **Completion / grade** | projection on `LmsEnrolment` (`progressPct`, `completedOn`, `finalGrade`) | source of truth | webhook `courseid`+`userid` → map rows | `webhook.js` handlers |

Dedup guarantees: `MoodleUserMap.crmUser` is unique; `LmsEnrolment (crmUser,
moodleCourseId)` is unique; every create is an upsert keyed on the CRM `_id`
stamped into Moodle `idnumber`. Re-running any sync is a no-op.

## Error / retry handling (already built)

- **MoodleClient**: 3 retries w/ exponential backoff on network / 5xx; a
  circuit breaker opens after 5 consecutive failures (fails fast for 30 s);
  logical Moodle errors are surfaced immediately, not retried.
- **Outbound queue** (`LmsSyncJob`): `jobs/lmsSyncTick.js` drains every 15 s;
  failed jobs back off `tick·2^attempt`; after 6 attempts → `dead` (visible
  at `/api/lms/admin/jobs?status=dead`, re-runnable via `.../jobs/:id/retry`).
- **Inbound webhook** (`LmsWebhookEvent`): stored before processing, unique on
  `eventId` (replays are recognised); failed rows retried by the tick, →
  `dead` after 6.
- **Reconcile**: nightly (`LMS_SYNC_RECONCILE_HOUR`, default 03:00) + on
  demand — reports drift counts. Full row-by-row diff is Phase 8.
- **Degraded mode**: if `MOODLE_WS_URL` is unset or Moodle is down, portals
  render a "not connected" / "offline data" state, the webhook returns 503,
  and sync jobs park as `pending` — nothing errors, nothing is lost.

---

## 7. Tests — run in this order

Set up a shell on the **CRM** box (or your laptop against the CRM API):

```bash
CRM=http://200.141.5.195               # the CRM's current address (unchanged)
# A management-role CRM login token (owner / Super Admin / Admin / Sales Manager):
TOKEN=<CRM_BEARER_TOKEN>
H="-H Authorization:Bearer=$TOKEN -H Content-Type:application/json"
j() { curl -s $H "$@" | python3 -m json.tool; }   # pretty-print helper
```

> The CRM uses a `Bearer=` token (note the `=`). Grab yours from the browser
> devtools (Network → any `/api/*` request → `Authorization` header) or from
> `localStorage.auth`.

### Test 1 — CRM → Moodle connection

```bash
j -X POST $CRM/api/lms/admin/test-connection
```
**Expect:** `{"success":true,"result":{"ok":true,"latencyMs":<~50-400>,"sitename":"CLC Learning","release":"4.5...","wsUser":"crm.service","functionCount":<25+>}}`
**If `ok:false`:** `not_configured` → env not loaded (restart pm2); `invalidtoken` → wrong `MOODLE_WS_TOKEN`; `accessexception` → function not added to the service or WS user lacks the capability; timeout → firewall / IP restriction.

### Test 2 — create one test user + provision

Pick any existing CRM user id (or make a throwaway one in *User Management*),
then:

```bash
CRM_USER_ID=<some Admin _id>
j -X POST $CRM/api/lms/admin/sync-user/$CRM_USER_ID
```
**Expect:** `{"success":true,"result":{"crmUserId":"…","moodleUserId":<int>,"username":"<slug>.<6hex>","lmsRole":"student|counsellor|admin|superadmin","syncStatus":"synced","lastError":null}}`
**Verify in Moodle:** *Site admin → Users → Browse* → the user exists, its
*ID number* equals the CRM `_id`.
**Re-run the same command** → same `moodleUserId`, still `synced` (idempotent, no duplicate).

### Test 3 — Moodle → CRM webhook

Fast path (no waiting on Moodle cron), signs a synthetic event with the real
HMAC secret and posts it to the CRM's own inbound endpoint:

```bash
j -X POST $CRM/api/lms/admin/webhook-selftest
```
**Expect:** `firstPost.httpCode:200` with `status:"skipped"` (a `ping` event has no handler — that's success: it was *received, verified, stored*), and `replay.message:"duplicate"` (idempotency proven).
**Real path:** in Moodle open `/local/crmbridge/manage.php` → **Send test
event** → row shows `status: sent`, `httpcode: 200`. Then
`j $CRM/api/lms/admin/events` shows it.
**If 401:** secret mismatch between `.env` and the plugin. **If 403:**
`MOODLE_WEBHOOK_ALLOW_IPS` doesn't include the Moodle box.

### Test 4 — SSO login

```bash
curl -s $H "$CRM/api/lms/sso/login-url?wantsurl=/my/"
```
**Expect:** `{"success":true,"result":{"url":"https://learn.<domain>/local/crmsso/login.php?token=eyJ…","expiresInSec":60}}`
Open that URL in a browser within 60 s → lands on the Moodle **Dashboard**,
logged in as that user, **no login form**. Open it a second time → rejected
(`token … replayed`) — single-use works.

### Test 5 — course synchronisation

```bash
CRM_COURSE_ID=<some Course _id>       # from the CRM LMS → Courses tab
j -X POST $CRM/api/lms/admin/sync-course/$CRM_COURSE_ID
```
**Expect:** `{"success":true,"result":{"crmCourseId":"…","moodleCourseId":<int>,"shortname":"clc-… or <code>","syncStatus":"synced"}}`
**Verify in Moodle:** *Site admin → Courses → Manage* → the course exists in
the default category, *ID number* = CRM `_id`, completion enabled.
**Re-run** → same `moodleCourseId` (idempotent).

### Test 6 — enrolment synchronisation

```bash
j -X POST $CRM/api/lms/admin/enrol \
  -d "{\"crmUserId\":\"$CRM_USER_ID\",\"crmCourseId\":\"$CRM_COURSE_ID\"}"
```
**Expect:** `{"success":true,"result":{"moodleUserId":<int>,"moodleCourseId":<int>,"status":"active","syncStatus":"synced"}}`
**Verify:** Moodle course → *Participants* → the user is listed as *Student*.
**Course access:** re-use Test 4 with `wantsurl=/course/view.php?id=<moodleCourseId>`
→ the SSO link drops the user straight into the course.
`j $CRM/api/lms/admin/mappings?type=enrolments` → the `LmsEnrolment` row.

### Test 7 — course completion synchronisation

In Moodle, as `admin`: course → *Course completion* → set a simple rule
(e.g. "manual self-completion" block, or mark an activity complete), then as
the test user mark the course complete. Moodle fires
`\core\event\course_completed`; `local_crmbridge` delivers it on the next
cron pass (≤ 60 s).

```bash
# wait ~60s, then:
j $CRM/api/lms/admin/events            # newest row: eventName ...course_completed, status "processed"
j "$CRM/api/lms/admin/mappings?type=enrolments"
```
**Expect:** the matching `LmsEnrolment` now has `progressPct: 100`,
`completedOn: <timestamp>`. The student's CRM `Student` row (matched by
email, if one exists) shows `progress: 100`.
**Force it without cron:** `sudo -u www-data php8.3 /var/www/moodle/admin/cli/cron.php`.

### Test 8 — reconcile

```bash
j -X POST $CRM/api/lms/admin/reconcile
```
**Expect:** `{"success":true,"result":{"moodleConfigured":true,"drift":{"usersPending":0,"usersFailed":0,"enrolPending":0,"enrolFailed":0,"staleUsers":<n>}}}`
Non-zero `*Failed` → inspect `GET /api/lms/admin/jobs?status=dead` and
`GET /api/lms/admin/events?status=dead`.

### Test 9 — provision-all

```bash
j -X POST $CRM/api/lms/admin/provision-all
```
**Expect:** `{"success":true,"result":{"queued":<N>}}` where `N` = enabled CRM
users not yet mapped. Watch them drain:
```bash
watch -n3 "curl -s $H $CRM/api/lms/admin/status | python3 -m json.tool | grep -E 'users|jobsPending|jobsDead'"
```
`jobsPending` → 0, `counts.users` rises to the full user count, `jobsDead` = 0.
Re-running `provision-all` returns `queued: 0`.

---

## Rollback

The CRM side is inert without the env vars:

```bash
# disable the integration, keep the data
sed -i 's/^MOODLE_WS_URL=.*/MOODLE_WS_URL=/' /var/www/clccrm/backend/.env
pm2 restart clccrm-api --update-env
```

Full Moodle removal (does **not** touch CRM / VICIdial / Asterisk / PHP 7.4):

```bash
systemctl disable --now moodle-cron.timer
rm -f /etc/systemd/system/moodle-cron.{service,timer}; systemctl daemon-reload
rm -f /etc/nginx/sites-enabled/moodle /etc/nginx/sites-available/moodle
rm -f /etc/php/8.3/fpm/pool.d/moodle.conf
systemctl reload nginx
mysql -e "DROP DATABASE IF EXISTS moodle; DROP USER IF EXISTS 'moodle'@'localhost';"
rm -rf /var/www/moodle /var/moodledata
# optional, only if nothing else uses them:
#   apt-get remove 'php8.3-*' ; [ -z "$(ls -A /etc/redis 2>/dev/null)" ] || apt-get remove redis-server
```

Nothing here removes PHP 7.4, Apache, MariaDB, the `asterisk` DB, the CRM
vhost, or the CRM Node process.

If anything regresses on the CRM/telephony side, restore from
`/root/backups/<date>/` (§1).
