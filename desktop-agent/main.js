// CLC Desktop Agent — Attendance ERP (design board A13 / E9).
//
// What it sends every 30 s to POST {server}/api/erp-agent-public/beat:
//   idleSec      seconds since the last keyboard OR mouse input (OS idle time)
//   kbAgoSec     seconds since the last key press   (only if uiohook-napi is installed)
//   mouseAgoSec  seconds since the last mouse move/click
//   power        on | locked | sleep | off
//   events       boot / lock / unlock / sleep / wake / shutdown since the last beat
// PRIVACY: it never reads WHICH key was pressed, never typed text, screens,
// files, app names or browser history. Only timestamps of "an input happened".
//
// Pairing: the employee opens /employee › Desktop agent › "Connect this laptop"
// and types the 6-digit code here. No CRM login happens on the laptop, so the
// one-device login rule never logs the browser out.
const { app, Tray, Menu, BrowserWindow, powerMonitor, ipcMain, nativeImage, safeStorage } = require('electron');
const os = require('os');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const VERSION = require('./package.json').version;
const DEFAULT_SERVER = 'https://clcone.careerlabconsulting.com';
const CFG = () => path.join(app.getPath('userData'), 'agent.json');
let cfg = { server: DEFAULT_SERVER, deviceId: '', token: '', employee: '' };
let tray = null;
let setupWin = null;
let power = 'on';
let queue = [{ kind: 'agent_start', at: new Date().toISOString() }];
let lastKb = 0;
let lastMouse = 0;
let lastOk = 0;
let hbSec = 30;

// ── config (token encrypted with the OS keychain when available) ─────────────
function load() {
  try {
    const raw = JSON.parse(fs.readFileSync(CFG(), 'utf8'));
    cfg = { ...cfg, ...raw };
    if (raw.tokenEnc && safeStorage.isEncryptionAvailable()) cfg.token = safeStorage.decryptString(Buffer.from(raw.tokenEnc, 'base64'));
  } catch (e) {
    /* first run */
  }
  if (!cfg.deviceId) cfg.deviceId = crypto.randomUUID();
}
function save() {
  const out = { server: cfg.server, deviceId: cfg.deviceId, employee: cfg.employee };
  if (cfg.token) {
    if (safeStorage.isEncryptionAvailable()) out.tokenEnc = safeStorage.encryptString(cfg.token).toString('base64');
    else out.token = cfg.token;
  }
  fs.mkdirSync(path.dirname(CFG()), { recursive: true });
  fs.writeFileSync(CFG(), JSON.stringify(out, null, 2));
}

// ── keyboard / mouse presence (optional, needs uiohook-napi) ─────────────────
// Only the TIME of an event is kept. event.keycode is never read or stored.
function startHooks() {
  try {
    const { uIOhook } = require('uiohook-napi');
    uIOhook.on('keydown', () => {
      lastKb = Date.now();
    });
    const m = () => {
      lastMouse = Date.now();
    };
    uIOhook.on('mousemove', m);
    uIOhook.on('mousedown', m);
    uIOhook.on('wheel', m);
    uIOhook.start();
    return true;
  } catch (e) {
    return false; // falls back to the OS idle time only (keyboard + mouse together)
  }
}

// ── power events ─────────────────────────────────────────────────────────────
function ev(kind, p) {
  queue.push({ kind, at: new Date().toISOString() });
  if (p) power = p;
  beat();
}

async function post(url, body, headers = {}) {
  const r = await fetch(`${cfg.server.replace(/\/+$/, '')}${url}`, { method: 'POST', headers: { 'Content-Type': 'application/json', ...headers }, body: JSON.stringify(body) });
  const j = await r.json().catch(() => ({}));
  return { status: r.status, ...j };
}

async function beat() {
  if (!cfg.token) return;
  const idleSec = powerMonitor.getSystemIdleTime();
  const now = Date.now();
  const body = {
    idleSec,
    kbAgoSec: lastKb ? Math.round((now - lastKb) / 1000) : null,
    mouseAgoSec: lastMouse ? Math.round((now - lastMouse) / 1000) : null,
    power: powerMonitor.getSystemIdleState(60) === 'locked' ? 'locked' : power,
    events: queue.slice(0, 50),
    clientTime: new Date().toISOString(),
    version: VERSION,
  };
  try {
    const r = await post('/api/erp-agent-public/beat', body, { 'X-Device-Token': cfg.token });
    if (r.success) {
      queue = queue.slice(body.events.length);
      lastOk = Date.now();
      if (r.result && r.result.heartbeatSec) hbSec = r.result.heartbeatSec;
    } else if (r.status === 401) {
      cfg.token = ''; // revoked — ask for a new code
      save();
      openSetup();
    }
  } catch (e) {
    /* offline — events stay queued, sent when back */
  }
  updateTray();
}

// ── tray + setup window ──────────────────────────────────────────────────────
function updateTray() {
  if (!tray) return;
  const online = cfg.token && Date.now() - lastOk < 90000;
  tray.setToolTip(`CLC Desktop Agent — ${!cfg.token ? 'not connected' : online ? `connected (${cfg.employee || 'employee'})` : 'offline, retrying'}`);
  tray.setContextMenu(
    Menu.buildFromTemplate([
      { label: `CLC Desktop Agent v${VERSION}`, enabled: false },
      { label: cfg.token ? `Connected: ${cfg.employee || 'employee'}` : 'Not connected', enabled: false },
      { label: 'Only “keyboard / mouse used yes-no” is sent — never keys or screens', enabled: false },
      { type: 'separator' },
      { label: cfg.token ? 'Connect again (new code)' : 'Connect this laptop…', click: openSetup },
      { label: 'Open Employee Portal', click: () => require('electron').shell.openExternal(`${cfg.server}/employee/agent`) },
    ])
  );
}

function openSetup() {
  if (setupWin) return setupWin.focus();
  setupWin = new BrowserWindow({ width: 440, height: 420, resizable: false, title: 'Connect CLC Desktop Agent', webPreferences: { nodeIntegration: true, contextIsolation: false } });
  setupWin.setMenu(null);
  setupWin.loadFile(path.join(__dirname, 'setup.html'), { query: { server: cfg.server } });
  setupWin.on('closed', () => {
    setupWin = null;
  });
}

ipcMain.handle('pair', async (_e, { code, server }) => {
  cfg.server = server || DEFAULT_SERVER;
  try {
    const r = await post('/api/erp-agent-public/pair', { code, deviceId: cfg.deviceId, hostname: os.hostname(), os: `${os.type()} ${os.release()}`, version: VERSION });
    if (!r.success) return { ok: false, message: r.message || 'Could not connect' };
    cfg.token = r.result.deviceToken;
    cfg.employee = r.result.employee || '';
    save();
    beat();
    setTimeout(() => setupWin && setupWin.close(), 1500);
    return { ok: true, message: r.message };
  } catch (e) {
    return { ok: false, message: 'Server not reachable. Check the internet and the server address.' };
  }
});

app.whenReady().then(() => {
  if (!app.requestSingleInstanceLock()) return app.quit();
  load();
  save();
  app.setLoginItemSettings({ openAtLogin: true }); // starts with Windows / macOS
  if (process.platform === 'darwin' && app.dock) app.dock.hide();
  const icon = fs.existsSync(path.join(__dirname, 'icon.png')) ? nativeImage.createFromPath(path.join(__dirname, 'icon.png')) : nativeImage.createEmpty();
  tray = new Tray(icon);
  startHooks();
  // boot (first start after the OS came up)
  if (os.uptime() < 600) queue.push({ kind: 'boot', at: new Date(Date.now() - os.uptime() * 1000).toISOString() });
  powerMonitor.on('lock-screen', () => ev('lock', 'locked'));
  powerMonitor.on('unlock-screen', () => ev('unlock', 'on'));
  powerMonitor.on('suspend', () => ev('sleep', 'sleep'));
  powerMonitor.on('resume', () => ev('wake', 'on'));
  powerMonitor.on('shutdown', () => ev('shutdown', 'off'));
  updateTray();
  if (!cfg.token) openSetup();
  const loop = () => {
    beat().finally(() => setTimeout(loop, hbSec * 1000));
  };
  loop();
});
app.on('window-all-closed', (e) => e.preventDefault()); // keep running in the tray
app.on('before-quit', () => {
  queue.push({ kind: 'agent_stop', at: new Date().toISOString() });
  beat();
});
