#!/usr/bin/env bash
###############################################################################
# CLC LMS — Moodle 4.5 LTS setup, co-located on the existing CRM VPS
# (Ubuntu 22.04, Hostinger 200.141.5.195). Phase 0 of the Moodle LMS Build
# Blueprint.
#
#   Run as root on the server:
#       DOMAIN=learn.yourdomain.com bash /var/www/clccrm/deploy/moodle/setup.sh
#
# What it does (ADDITIVE ONLY — see the per-stage notes and deploy/moodle/
# CONNECT.md for the blast radius):
#   - installs a DEDICATED PHP 8.x-FPM (default 8.3) *alongside* the box's
#     existing PHP 7.4 (which VICIdial/Apache use — untouched), with its own
#     memory-capped pool
#   - installs Redis; installs MariaDB ONLY if no SQL server is already running
#   - creates the `moodle` schema + user (GRANT scoped to moodle.* only —
#     never reads or alters VICIdial's `asterisk` DB)
#   - fetches Moodle 4.5 (MOODLE_405_STABLE) into /var/www/moodle
#   - lays down config.php, moodledata, a NAME-BASED nginx vhost (not
#     default_server — the CRM vhost keeps that), and a systemd cron timer
#   - installs the two CRM plugins from this repo (local_crmbridge/local_crmsso)
#
# It does NOT: touch PHP 7.4, Apache, the Asterisk service, VICIdial, the CRM
# nginx vhost, the CRM Node process, or any DB other than `moodle`. It does NOT
# run the Moodle web installer or obtain certs — do those interactively after
# (see the "Next" block it prints).
###############################################################################
set -euo pipefail

APP_DIR="${APP_DIR:-/var/www/clccrm}"
MOODLE_DIR="${MOODLE_DIR:-/var/www/moodle}"
MOODLE_DATA="${MOODLE_DATA:-/var/moodledata}"
MOODLE_BRANCH="${MOODLE_BRANCH:-MOODLE_405_STABLE}"
DOMAIN="${DOMAIN:-learn.local}"
DB_NAME="${DB_NAME:-moodle}"
DB_USER="${DB_USER:-moodle}"
DB_PASS="${DB_PASS:-$(head -c18 /dev/urandom | base64 | tr -d '/+=' )}"
PHP_VER="${PHP_VER:-8.3}"           # dedicated Moodle PHP — coexists with 7.4
PHP_MEM="${PHP_MEM:-256M}"          # per-request cap — modest on a 2-vCPU box
PHP_POOL_MAX="${PHP_POOL_MAX:-6}"   # pm.max_children — bound total PHP memory
USE_REDIS="${USE_REDIS:-1}"

# PILOT=1 → internal test mode: Moodle binds to 127.0.0.1:8081 (NOT public),
# no domain, no TLS, reached over an SSH tunnel. wwwroot = http://localhost:8081.
PILOT="${PILOT:-0}"
if [ "$PILOT" = "1" ]; then
    PILOT_PORT="${PILOT_PORT:-8081}"
    WWWROOT="http://localhost:${PILOT_PORT}"
    VHOST_SRC="$APP_DIR/deploy/moodle/nginx-learn-pilot.conf"
else
    WWWROOT="https://${DOMAIN}"
    VHOST_SRC="$APP_DIR/deploy/moodle/nginx-learn.conf"
fi

echo "==> MOODLE_DIR=$MOODLE_DIR  DATA=$MOODLE_DATA  BRANCH=$MOODLE_BRANCH"
echo "==> PILOT=$PILOT  WWWROOT=$WWWROOT  PHP_VER=$PHP_VER  PHP_POOL_MAX=$PHP_POOL_MAX  USE_REDIS=$USE_REDIS"
[ "$(id -u)" -eq 0 ] || { echo "!! run as root"; exit 1; }
export DEBIAN_FRONTEND=noninteractive

### 0. PRE-FLIGHT — protect the existing CRM / VICIdial / Asterisk ------------
FORCE="${FORCE:-0}"
PREFLIGHT_FAIL=0
warn() { echo "  [!] $*"; PREFLIGHT_FAIL=1; }
echo "==> pre-flight checks"

# a) Existing SQL server (VICIdial's `asterisk` DB lives on one). If one runs
#    we install NO db-server package and never restart it.
EXISTING_DB=0
if systemctl is-active --quiet mysql || systemctl is-active --quiet mariadb; then
    EXISTING_DB=1
    echo "  [i] SQL server already running — Moodle will use it; no DB-server package, no restart"
    if command -v mysql >/dev/null && mysql -N -e "SHOW DATABASES" 2>/dev/null | grep -qiE '^(asterisk|vicidial)$'; then
        echo "  [i] VICIdial schema present — the moodle DB is created ALONGSIDE it (separate schema; GRANT scoped to moodle.*)"
    fi
fi

# b) Existing PHP / Apache (VICIdial). We add a dedicated PHP $PHP_VER-fpm and
#    leave everything else alone.
if command -v php >/dev/null; then
    echo "  [i] system php: $(php -r 'echo PHP_VERSION;' 2>/dev/null) — NOT touched"
fi
if dpkg -l 2>/dev/null | grep -q '^ii  libapache2-mod-php'; then
    echo "  [i] Apache mod_php present (VICIdial UI) — NOT touched; Moodle uses nginx + php${PHP_VER}-fpm"
fi

# c) RAM / disk
MEM_AVAIL_MB=$(awk '/MemAvailable/ {print int($2/1024)}' /proc/meminfo)
echo "  [i] MemAvailable: ${MEM_AVAIL_MB} MB"
[ "${MEM_AVAIL_MB:-0}" -lt 1500 ] && warn "less than 1.5 GB available RAM — add swap or resize first"
DISK_AVAIL_GB=$(df -BG --output=avail / | tail -1 | tr -dc '0-9')
echo "  [i] free disk on /: ${DISK_AVAIL_GB} GB"
[ "${DISK_AVAIL_GB:-0}" -lt 10 ] && warn "less than 10 GB free on / — Moodle media + backups will fill it"

# d) Asterisk
if systemctl list-units --type=service --all 2>/dev/null | grep -qi asterisk; then
    echo "  [i] Asterisk service present — NOT touched; php-fpm + (any) MariaDB are memory-capped"
fi

# e) don't clobber an existing moodle vhost
if [ -e /etc/nginx/sites-enabled/moodle ] && [ "$FORCE" != "1" ]; then
    warn "/etc/nginx/sites-enabled/moodle already exists — set FORCE=1 to overwrite"
fi

if [ "$PREFLIGHT_FAIL" = "1" ] && [ "$FORCE" != "1" ]; then
    echo
    echo "!! pre-flight raised warnings. Review, back up (deploy/moodle/CONNECT.md §1),"
    echo "   then re-run:  FORCE=1 bash $0"
    exit 2
fi

### 1. Packages (additive) --------------------------------------------------------
apt-get update -y
apt-get install -y software-properties-common ca-certificates rsync curl git unzip

# The box already has the sury/ondrej PHP repo (that's where php7.4 came from),
# so php${PHP_VER} is usually installable with no new repo. Add the PPA only if
# there is no candidate.
if ! apt-cache policy "php${PHP_VER}-fpm" 2>/dev/null | grep -q 'Candidate: [0-9]'; then
    echo "==> php${PHP_VER}-fpm not available — adding ppa:ondrej/php"
    add-apt-repository -y ppa:ondrej/php
    apt-get update -y
fi

PKGS="php${PHP_VER}-fpm php${PHP_VER}-cli php${PHP_VER}-common php${PHP_VER}-mysql \
php${PHP_VER}-xml php${PHP_VER}-mbstring php${PHP_VER}-curl php${PHP_VER}-zip \
php${PHP_VER}-gd php${PHP_VER}-intl php${PHP_VER}-soap php${PHP_VER}-bcmath \
php${PHP_VER}-ldap php${PHP_VER}-opcache"
[ "$USE_REDIS" = "1" ] && PKGS="$PKGS redis-server php${PHP_VER}-redis"
[ "$EXISTING_DB" = "0" ] && PKGS="$PKGS mariadb-server"
# nginx is already installed on this box; include it so a bare box also works.
PKGS="$PKGS nginx"

apt-get install -y $PKGS

### 2. Dedicated PHP-FPM pool (isolated; does NOT touch php7.4 or any shared pool)
PHP_SOCK="/run/php/php${PHP_VER}-fpm-moodle.sock"
cat > "/etc/php/${PHP_VER}/fpm/pool.d/moodle.conf" <<POOL
[moodle]
user = www-data
group = www-data
listen = ${PHP_SOCK}
listen.owner = www-data
listen.group = www-data
pm = dynamic
pm.max_children = ${PHP_POOL_MAX}
pm.start_servers = 2
pm.min_spare_servers = 1
pm.max_spare_servers = 3
pm.max_requests = 500
php_admin_value[memory_limit] = ${PHP_MEM}
php_admin_value[max_input_vars] = 5000
php_admin_value[upload_max_filesize] = 200M
php_admin_value[post_max_size] = 200M
php_admin_value[max_execution_time] = 120
POOL
# NB: we deliberately do NOT touch the default www.conf pool.
systemctl enable --now "php${PHP_VER}-fpm"
systemctl restart "php${PHP_VER}-fpm"

### 3. Database — the `moodle` schema ONLY -------------------------------------
# CREATE ... IF NOT EXISTS scoped to ${DB_NAME}; GRANT scoped to ${DB_NAME}.*.
# No other database (e.g. VICIdial's `asterisk`) is read or altered.
mysql <<SQL
CREATE DATABASE IF NOT EXISTS ${DB_NAME} DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
CREATE USER IF NOT EXISTS '${DB_USER}'@'localhost' IDENTIFIED BY '${DB_PASS}';
GRANT ALL PRIVILEGES ON ${DB_NAME}.* TO '${DB_USER}'@'localhost';
FLUSH PRIVILEGES;
SQL

if [ "$EXISTING_DB" = "1" ]; then
    echo "  [i] pre-existing SQL server — NOT writing my.cnf, NOT restarting it."
    echo "      If Moodle load grows, hand-tune innodb_buffer_pool_size within the box's RAM budget."
else
    cat > /etc/mysql/mariadb.conf.d/90-moodle.cnf <<CNF
[mysqld]
innodb_buffer_pool_size = 512M
innodb_file_per_table = 1
innodb_flush_log_at_trx_commit = 2
max_connections = 120
slow_query_log = 1
slow_query_log_file = /var/log/mysql/slow.log
long_query_time = 2
CNF
    systemctl restart mariadb
fi

### 4. Moodle source ----------------------------------------------------------
if [ ! -d "$MOODLE_DIR/.git" ]; then
    git clone --depth 1 -b "$MOODLE_BRANCH" https://github.com/moodle/moodle.git "$MOODLE_DIR"
fi
mkdir -p "$MOODLE_DATA"
chown -R www-data:www-data "$MOODLE_DIR" "$MOODLE_DATA"
chmod 0770 "$MOODLE_DATA"

### 5. config.php (idempotent) ---------------------------------------------------
DB_TYPE="${DB_TYPE:-mariadb}"
if [ "$EXISTING_DB" = "1" ]; then
    if mysql -N -e "SELECT VERSION()" 2>/dev/null | grep -qi mariadb; then DB_TYPE="mariadb"; else DB_TYPE="mysqli"; fi
    echo "  [i] SQL server driver: $DB_TYPE"
fi
if [ ! -f "$MOODLE_DIR/config.php" ]; then
REDIS_BLOCK=""
if [ "$USE_REDIS" = "1" ]; then
REDIS_BLOCK="\$CFG->session_handler_class = '\\\\core\\\\session\\\\redis';
\$CFG->session_redis_host = '127.0.0.1';
\$CFG->session_redis_prefix = 'mdl_sess_';"
fi
cat > "$MOODLE_DIR/config.php" <<CFG
<?php
unset(\$CFG);
global \$CFG;
\$CFG = new stdClass();
\$CFG->dbtype    = '${DB_TYPE}';
\$CFG->dblibrary = 'native';
\$CFG->dbhost    = '127.0.0.1';
\$CFG->dbname    = '${DB_NAME}';
\$CFG->dbuser    = '${DB_USER}';
\$CFG->dbpass    = '${DB_PASS}';
\$CFG->prefix    = 'mdl_';
\$CFG->dboptions = ['dbpersist' => 0, 'dbsocket' => 0, 'dbport' => 3306];

\$CFG->wwwroot   = '${WWWROOT}';
\$CFG->dataroot  = '${MOODLE_DATA}';
\$CFG->admin     = 'admin';
\$CFG->directorypermissions = 0770;

${REDIS_BLOCK}

// Web services / integration
\$CFG->enablewebservices = true;

require_once(__DIR__ . '/lib/setup.php');
CFG
chown www-data:www-data "$MOODLE_DIR/config.php"
chmod 0640 "$MOODLE_DIR/config.php"
fi

### 6. CRM plugins from this repo ------------------------------------------------
if [ -d "$APP_DIR/moodle/local_crmbridge" ]; then
    rsync -a --delete "$APP_DIR/moodle/local_crmbridge/" "$MOODLE_DIR/local/crmbridge/"
    rsync -a --delete "$APP_DIR/moodle/local_crmsso/"    "$MOODLE_DIR/local/crmsso/"
    chown -R www-data:www-data "$MOODLE_DIR/local/crmbridge" "$MOODLE_DIR/local/crmsso"
fi

### 7. nginx vhost (NAME-BASED — the CRM keeps default_server) -----------------
install -m 0644 "$VHOST_SRC" /etc/nginx/sites-available/moodle
sed -i "s/__DOMAIN__/${DOMAIN}/g; s#__MOODLE_DIR__#${MOODLE_DIR}#g; s#__PHP_SOCK__#${PHP_SOCK}#g" \
    /etc/nginx/sites-available/moodle
ln -sf /etc/nginx/sites-available/moodle /etc/nginx/sites-enabled/moodle
# Adding a NEW server block only. The CRM's default_server on :80 is unchanged.
nginx -t && systemctl reload nginx

### 8. Moodle cron on a systemd timer (every minute) --------------------------
# NB: the versioned binary — bare `php` on this box is 7.4 and would fail.
cat > /etc/systemd/system/moodle-cron.service <<UNIT
[Unit]
Description=Moodle cron
After=network-online.target
[Service]
Type=oneshot
User=www-data
ExecStart=/usr/bin/php${PHP_VER} ${MOODLE_DIR}/admin/cli/cron.php
UNIT
cat > /etc/systemd/system/moodle-cron.timer <<UNIT
[Unit]
Description=Run Moodle cron every minute
[Timer]
OnBootSec=2min
OnUnitActiveSec=1min
AccuracySec=10s
[Install]
WantedBy=timers.target
UNIT
systemctl daemon-reload
systemctl enable --now moodle-cron.timer

### 9. Firewall + done -----------------------------------------------------------
# PILOT mode binds nginx to 127.0.0.1:8081 (loopback) — NO firewall rule, NOT
# public. Domain mode needs 443 (already open on this box, so a harmless no-op).
if [ "$PILOT" != "1" ]; then
    command -v ufw >/dev/null && ufw allow 443/tcp || true
fi

PHP_BIN="/usr/bin/php${PHP_VER}"
echo
echo "=============================================================="
echo " Moodle files + services are in place. Next, INTERACTIVELY:"
echo
if [ "$PILOT" = "1" ]; then
  echo " [PILOT] Moodle is on 127.0.0.1:${PILOT_PORT:-8081} — reach it via an SSH tunnel"
  echo "         from your laptop:"
  echo "            ssh -L 8081:127.0.0.1:8081 root@200.141.5.195"
  echo "         then browse  ${WWWROOT}"
  echo
  echo "    (config.php already has wwwroot=${WWWROOT})"
  echo " 1. Install DB (sets the admin password) — versioned php binary:"
  echo "      sudo -u www-data ${PHP_BIN} ${MOODLE_DIR}/admin/cli/install_database.php \\"
  echo "        --agree-license --adminpass='CHANGE-ME' --adminemail='you@org.com' \\"
  echo "        --fullname='CLC Learning' --shortname='CLC'"
  echo " 2. Install plugin tables:"
  echo "      sudo -u www-data ${PHP_BIN} ${MOODLE_DIR}/admin/cli/upgrade.php --non-interactive"
  echo " 3. Enable REST + create the CRM web-service token (CONNECT.md §3)."
  echo " 4. Configure local_crmbridge (CRM base URL = http://127.0.0.1:8888)"
  echo "    and local_crmsso (CONNECT.md §5–6 / PILOT.md)."
  echo " 5. CRM backend/.env:  MOODLE_WS_URL=${WWWROOT}   (+ token + secrets)"
  echo " 6. Role ids for MOODLE_ROLE_IDS:"
  echo "      mysql -N -e \"SELECT CONCAT('\\\"',shortname,'\\\":',id) FROM ${DB_NAME}.mdl_role\" | paste -sd,"
else
  echo " 1. TLS:   certbot --nginx -d ${DOMAIN}"
  echo " 2. Install DB (sets the admin password) — use the versioned php binary:"
  echo "      sudo -u www-data ${PHP_BIN} ${MOODLE_DIR}/admin/cli/install_database.php \\"
  echo "        --agree-license --adminpass='CHANGE-ME' --adminemail='you@org.com' \\"
  echo "        --fullname='CLC Learning' --shortname='CLC'"
  echo " 3. Install plugin tables:"
  echo "      sudo -u www-data ${PHP_BIN} ${MOODLE_DIR}/admin/cli/upgrade.php --non-interactive"
  echo " 4. Enable REST + create the CRM web-service token (CONNECT.md §3)."
  echo " 5. Configure local_crmbridge + local_crmsso (CONNECT.md §5–6)."
  echo " 6. Role ids for the CRM .env (MOODLE_ROLE_IDS):"
  echo "      mysql -N -e \"SELECT CONCAT('\\\"',shortname,'\\\":',id) FROM ${DB_NAME}.mdl_role\" | paste -sd,"
fi
echo
echo " DB pass (also in ${MOODLE_DIR}/config.php):  ${DB_PASS}"
echo " PHP-FPM socket: ${PHP_SOCK}"
echo "=============================================================="
