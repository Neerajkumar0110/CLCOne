# CLC LMS — Moodle setup (co-located on the CRM VPS)

Phase 0 of the **Moodle LMS Build Blueprint**. Moodle 4.5 LTS + MariaDB +
Redis on the existing Hostinger box (`200.141.5.195`), beside the Node CRM and
Asterisk/VICIdial. BigBlueButton runs on its **own** server — see
`deploy/bbb/`.

> ⚠️ Co-location is the accepted launch trade-off, not the target. `setup.sh`
> caps the PHP-FPM pool and the MariaDB buffer pool so Moodle cannot starve
> the CRM or call traffic. Move Moodle to a dedicated host when sustained load
> passes ~70% or call quality regresses (Blueprint §12).

## 1. Run the setup script

```bash
# on the VPS, as root
DOMAIN=learn.yourdomain.com bash /var/www/clccrm/deploy/moodle/setup.sh
```

Installs a dedicated **`php8.3-fpm`** (override with `PHP_VER=`) *alongside* the
box's existing PHP 7.4 (untouched), an isolated FPM pool, and Redis; installs
MariaDB **only if none is running** (this box already has one — it just creates
the `moodle` schema); clones Moodle `MOODLE_405_STABLE` to `/var/www/moodle`;
writes `config.php`, a name-based nginx vhost, a systemd cron timer (every
minute, calling `php8.3`); copies the two CRM plugins from `moodle/` in this
repo. It prints the generated DB password and the FPM socket path.

> On this VPS `php` = 7.4 (VICIdial). Always run Moodle CLI with the versioned
> binary: **`sudo -u www-data php8.3 …`**.

## 2. TLS

```bash
certbot --nginx -d learn.yourdomain.com
```

## 3. Install the database (sets the admin account)

```bash
sudo -u www-data php8.3 /var/www/moodle/admin/cli/install_database.php \
  --agree-license \
  --adminpass='<strong-password>' \
  --adminemail='ops@yourorg.com' \
  --fullname='CLC Learning' --shortname='CLC'
```

This `admin` account is **break-glass only** — real users come in through
`local_crmsso`. Give it MFA.

## 4. Web services token for the CRM

In *Site administration → Server → Web services*:

1. **Overview** → enable web services.
2. **Manage protocols** → enable **REST**.
3. **External services** → *Add* → name `CRM integration`, enabled, *Authorised
   users only*, tick *Can download/upload files*.
4. Add these functions (Phase 1 set):
   `core_webservice_get_site_info`, `core_user_get_users_by_field`,
   `core_user_create_users`, `core_user_update_users`,
   `core_role_assign_roles`, `core_role_unassign_roles`,
   `core_cohort_create_cohorts`, `core_cohort_update_cohorts`,
   `core_cohort_add_cohort_members`, `core_cohort_delete_cohort_members`,
   `core_course_get_courses`, `core_course_get_courses_by_field`,
   `core_course_get_categories`, `core_course_get_contents`,
   `core_course_create_categories`, `core_course_create_courses`,
   `core_course_update_courses`,
   `enrol_manual_enrol_users`, `enrol_manual_unenrol_users`,
   `core_enrol_get_enrolled_users`, `core_enrol_get_users_courses`,
   `core_completion_get_course_completion_status`,
   `core_completion_get_activities_completion_status`,
   `gradereport_user_get_grade_items`, `core_calendar_get_calendar_events`,
   `mod_bigbluebuttonbn_get_recordings`.
5. Create a dedicated **system account** (manual auth, a real email), add it as
   an authorised user of the service, and assign it a role at system context
   with the matching capabilities (or `manager`).
6. **Manage tokens** → create a token for that account + service.
7. Restrict the service to the CRM server IP (*valid IP range* on the token)
   **and** the OS firewall.

Put the token + site URL in the CRM `backend/.env`:

```
MOODLE_WS_URL=https://learn.yourdomain.com
MOODLE_WS_TOKEN=<token>
```

## 5. Role ids

```bash
mysql -N -e "SELECT CONCAT('\"',shortname,'\":',id) FROM moodle.mdl_role" | paste -sd,
# -> {"manager":1,"coursecreator":2,"editingteacher":3,"teacher":4,"student":5,...}
```

Wrap in braces and set `MOODLE_ROLE_IDS` in the CRM `.env`. If you add the
custom `counsellor` / `contentmanager` roles (Blueprint §07), re-run this.

## 6. Plugins

Configure `local_crmbridge` and `local_crmsso` per `moodle/README.md`. Then
from the CRM:

```
POST /api/lms/admin/provision-all      # mirror existing CRM users into Moodle
GET  /api/lms/admin/status             # should show moodleReachable: true
```

## 7. Backups (wire on day one)

```bash
# /etc/cron.d/moodle-backup
0 * * * * root mysqldump --single-transaction moodle | zstd > /var/backups/moodle/db-$(date +\%Y\%m\%d\%H).sql.zst
30 2 * * * root rsync -a --delete /var/moodledata/ /var/backups/moodle/moodledata/
```

Then ship `/var/backups/moodle` off-box to object storage (Blueprint §11).

## Operations

| Task | Command |
| --- | --- |
| Run cron now | `sudo -u www-data php8.3 /var/www/moodle/admin/cli/cron.php` |
| Purge caches | `sudo -u www-data php8.3 /var/www/moodle/admin/cli/purge_caches.php` |
| Upgrade after plugin change | `sudo -u www-data php8.3 /var/www/moodle/admin/cli/upgrade.php --non-interactive` |
| Maintenance mode | `sudo -u www-data php8.3 /var/www/moodle/admin/cli/maintenance.php --enable` |
| nginx error log | `tail -f /var/log/nginx/moodle.error.log` |
