#!/usr/bin/env bash
###############################################################################
# CLC CRM — one-shot VPS setup for Ubuntu 22.04 (bare IP, HTTP only)
#
#   Run as root on the server:
#       bash /var/www/clccrm/deploy/vps/setup.sh
#
#   or, before the repo is cloned:
#       curl -fsSL https://raw.githubusercontent.com/Neerajkumar0110/CLCOne/main/deploy/vps/setup.sh | bash
#
# Override defaults with env vars, e.g.:
#       REPO_URL="https://<token>@github.com/Neerajkumar0110/CLCOne.git" bash setup.sh
###############################################################################
set -euo pipefail

APP_DIR="${APP_DIR:-/var/www/clccrm}"
REPO_URL="${REPO_URL:-https://github.com/Neerajkumar0110/CLCOne.git}"
BRANCH="${BRANCH:-main}"
SERVER_IP="${SERVER_IP:-200.141.5.195}"
NODE_MAJOR="${NODE_MAJOR:-22}"

echo "==> APP_DIR=$APP_DIR"
echo "==> REPO_URL=$REPO_URL  BRANCH=$BRANCH"
echo "==> SERVER_IP=$SERVER_IP  NODE_MAJOR=$NODE_MAJOR"
[ "$(id -u)" -eq 0 ] || { echo "!! run as root"; exit 1; }

export DEBIAN_FRONTEND=noninteractive

### 1. Base packages -----------------------------------------------------------
apt-get update -y
apt-get install -y curl git ufw nginx build-essential ca-certificates \
    fontconfig libfontconfig1 bzip2

### 2. Swap — the Vite build is memory-hungry on a small KVM plan --------------
if ! swapon --show | grep -q '/swapfile'; then
    echo "==> creating 2G swapfile"
    fallocate -l 2G /swapfile || dd if=/dev/zero of=/swapfile bs=1M count=2048
    chmod 600 /swapfile
    mkswap /swapfile
    swapon /swapfile
    grep -q '/swapfile' /etc/fstab || echo '/swapfile none swap sw 0 0' >> /etc/fstab
fi

### 3. Node.js ---------------------------------------------------------------
node_ok=0
if command -v node >/dev/null 2>&1; then
    [ "$(node -v | sed 's/^v//' | cut -d. -f1)" -ge 20 ] && node_ok=1
fi
if [ "$node_ok" -eq 0 ]; then
    echo "==> installing Node.js ${NODE_MAJOR}.x"
    curl -fsSL "https://deb.nodesource.com/setup_${NODE_MAJOR}.x" | bash -
    apt-get install -y nodejs
fi
echo "==> node $(node -v) / npm $(npm -v)"

### 4. PM2 -----------------------------------------------------------------
command -v pm2 >/dev/null 2>&1 || npm install -g pm2

### 5. Clone / update the repo -------------------------------------------------
if [ -d "$APP_DIR/.git" ]; then
    echo "==> repo present — updating"
    git -C "$APP_DIR" remote set-url origin "$REPO_URL"
    git -C "$APP_DIR" fetch origin "$BRANCH"
    git -C "$APP_DIR" reset --hard "origin/$BRANCH"
else
    echo "==> cloning repo"
    mkdir -p "$(dirname "$APP_DIR")"
    git clone -b "$BRANCH" "$REPO_URL" "$APP_DIR"
fi

### 6. Backend .env ----------------------------------------------------------
if [ ! -f "$APP_DIR/backend/.env" ]; then
    cat <<EOF

!! $APP_DIR/backend/.env is missing.
   Copy your local backend/.env to the server, then re-run this script:

     # from your laptop:
     scp backend/.env root@${SERVER_IP}:${APP_DIR}/backend/.env

EOF
    exit 1
fi

# Force the values that must be right in production on this box.
node - "$APP_DIR/backend/.env" "$SERVER_IP" <<'NODE'
const fs = require('fs');
const [file, ip] = process.argv.slice(2);
let s = fs.readFileSync(file, 'utf8');
const set = (k, v) => {
  const re = new RegExp('^' + k + '=.*$', 'm');
  s = re.test(s) ? s.replace(re, k + '=' + v) : s.replace(/\s*$/, '\n') + k + '=' + v + '\n';
};
set('NODE_ENV', 'production');
set('PORT', '8888');
set('OPENSSL_CONF', '/dev/null');
set('PUBLIC_SERVER_FILE', `http://${ip}/`);
set('APP_URL', `http://${ip}/`);
fs.writeFileSync(file, s);
console.log('==> backend/.env production values applied');
NODE

### 7. Backend deps ----------------------------------------------------------
cd "$APP_DIR/backend"
npm ci --omit=dev || npm install --omit=dev
mkdir -p src/public/uploads

### 8. Frontend build ------------------------------------------------------
cd "$APP_DIR/frontend"
cat > .env.production <<EOF
VITE_BACKEND_SERVER=http://${SERVER_IP}/
VITE_FILE_BASE_URL=http://${SERVER_IP}/
EOF
npm ci || npm install
NODE_OPTIONS=--max-old-space-size=1536 npm run build

### 9. Nginx ---------------------------------------------------------------
install -m 644 "$APP_DIR/deploy/vps/nginx-clccrm.conf" /etc/nginx/sites-available/clccrm
sed -i "s#__APP_DIR__#${APP_DIR}#g" /etc/nginx/sites-available/clccrm
ln -sf /etc/nginx/sites-available/clccrm /etc/nginx/sites-enabled/clccrm
rm -f /etc/nginx/sites-enabled/default
nginx -t
systemctl reload nginx
systemctl enable nginx

### 10. Backend under PM2 -------------------------------------------------
cd "$APP_DIR/backend"
if pm2 describe clccrm-api >/dev/null 2>&1; then
    pm2 restart clccrm-api --update-env
else
    pm2 start src/server.js --name clccrm-api --time --update-env
fi
pm2 save
pm2 startup systemd -u root --hp /root | tail -n 1 | bash || true

### 11. Firewall -------------------------------------------------------------
ufw allow OpenSSH
ufw allow 80/tcp
ufw --force enable

cat <<EOF

============================================================
 Done.  Open  http://${SERVER_IP}/

 Checks:
   pm2 logs clccrm-api --lines 50      # backend health
   curl -s http://127.0.0.1:8888/api/  # should answer (404 JSON is fine)
   systemctl status nginx

 If the API can't reach MongoDB: add ${SERVER_IP} to the
 Atlas project's Network Access allowlist.
============================================================
EOF
