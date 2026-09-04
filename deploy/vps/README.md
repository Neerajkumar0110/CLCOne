# CLC CRM — VPS deployment (Hostinger, Ubuntu 22.04)

Target box: `srv1946469.hstgr.cloud` — **200.141.5.195**, SSH as `root`.
Runs on the **bare IP over HTTP** (no domain / HTTPS yet).

```
Browser ──80──> Nginx ──┬─ /            -> /var/www/clccrm/frontend/dist  (static React)
                        ├─ /api/        -> 127.0.0.1:8888  (Node/Express)
                        ├─ /public/     -> 127.0.0.1:8888  (uploads, OAuth callbacks, lead form)
                        ├─ /download/   -> 127.0.0.1:8888  (PDFs)
                        └─ /socket.io/  -> 127.0.0.1:8888
Node backend  ── MongoDB Atlas (already configured in backend/.env)
```

Backend process is managed by **PM2** (`clccrm-api`), auto-restarts on boot.

---

## One-time setup

### 1. Allow the VPS in MongoDB Atlas
Atlas → your project → **Network Access** → **Add IP Address** → `200.141.5.195`
(or `0.0.0.0/0` for now). Without this the backend cannot connect to the DB.

### 2. Get the setup kit onto the server

SSH in (Hostinger panel → *Web console*, or `ssh root@200.141.5.195`), then:

```bash
# public repo:
git clone -b main https://github.com/Neerajkumar0110/CLCOne.git /var/www/clccrm

# private repo — use a GitHub Personal Access Token (repo:read):
git clone -b main https://<TOKEN>@github.com/Neerajkumar0110/CLCOne.git /var/www/clccrm
```

### 3. Upload the backend env file
`backend/.env` is git-ignored, so copy your working local one up. From your laptop:

```bash
scp backend/.env root@200.141.5.195:/var/www/clccrm/backend/.env
```

`setup.sh` then force-sets these for this box (your secrets are kept):
`NODE_ENV=production`, `PORT=8888`, `OPENSSL_CONF=/dev/null`,
`PUBLIC_SERVER_FILE` / `APP_URL` = `http://200.141.5.195/`.

### 4. Run the setup script
```bash
bash /var/www/clccrm/deploy/vps/setup.sh
```
If you used a token in the clone URL, pass it again so future pulls work:
```bash
REPO_URL="https://<TOKEN>@github.com/Neerajkumar0110/CLCOne.git" \
  bash /var/www/clccrm/deploy/vps/setup.sh
```

It installs Node 22, Nginx, PM2; adds 2 GB swap; builds the frontend; wires
Nginx; starts the backend under PM2; opens ports 22 + 80 in UFW.

### 5. Verify
```bash
pm2 logs clccrm-api --lines 50          # "Express running → On PORT : 8888"
curl -s http://127.0.0.1:8888/api/      # JSON 404 = backend alive
```
Open **http://200.141.5.195/** and log in.

Also check Hostinger's own panel firewall (VPS → *Firewall*) allows inbound
**80/tcp** — it's open by default, but confirm if the page doesn't load.

---

## Updating after a code push

```bash
bash /var/www/clccrm/deploy/vps/deploy.sh
```
Pulls `main`, reinstalls deps, rebuilds the frontend, restarts PM2, reloads Nginx.

---

## Common operations

| Task | Command |
|---|---|
| Backend logs | `pm2 logs clccrm-api` |
| Restart backend | `pm2 restart clccrm-api` |
| Backend status | `pm2 status` |
| Nginx test + reload | `nginx -t && systemctl reload nginx` |
| Nginx error log | `tail -f /var/log/nginx/error.log` |
| Edit env then restart | `nano /var/www/clccrm/backend/.env && pm2 restart clccrm-api --update-env` |

---

## Known limitations on bare IP (revisit when a domain is added)

- **No HTTPS.** Login works (JWT in a header, not a Secure cookie), but traffic
  is unencrypted — fine for testing, not for real admin use.
- **OAuth integrations** (Meta / Google Ads / LinkedIn / GitHub / Vercel) stay
  pointed at the old `crm-official-backend.vercel.app` redirect URIs — those
  providers reject bare-IP callbacks. They stay non-functional here until a
  domain + HTTPS is set up, at which point: update every `*_REDIRECT_URI` in
  `backend/.env`, update the matching redirect URL in each provider console,
  add a `server_name`, and run `certbot --nginx`.
- Uploaded files live on local disk at `backend/src/public/uploads/` — included
  in PM2's cwd, but **not** in git. Back this folder up separately.
