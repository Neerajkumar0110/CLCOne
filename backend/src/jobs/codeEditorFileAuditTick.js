const fs = require('fs');
const path = require('path');
const mongoose = require('mongoose');
const auditLog = require('../services/lms/auditLog');

// Design rule: every Code Editor file save writes to the same AuditLog
// service the rest of the app already uses. OpenVSCode Server is a
// separate process the CRM backend doesn't otherwise hear from, so this
// watches the workspace filesystem directly instead of hooking the editor.
//
// NOTE — real limitation, not an oversight: OpenVSCode Server (like VS Code
// itself) has no built-in multi-tenant/multi-user model. One instance
// serves whoever is let through nginx's auth gate, with no per-connection
// identity the filesystem layer can see. So these audit entries record
// THAT a file changed while at least one Code Editor session was active,
// not WHICH admin changed it — true per-admin attribution would need a
// small VS Code extension bundled into the editor reporting saves with the
// acting identity directly, which is future scope, not built here.
//
// Same on/off-tick shape as jobs/callingRecordingSync.js: no watcher runs
// at all while nobody has an open session, so there's zero overhead most
// of the time.
const TICK_MS = 60 * 1000;
const DEBOUNCE_MS = 2000;
const WORKSPACE_ROOT = process.env.CODE_EDITOR_WORKSPACE || '/var/www/clccrm';
const EXCLUDE_TOP_LEVEL = new Set(['node_modules', '.git', 'dist', 'build', '.idea', '.github', 'coverage']);

let watchers = [];
const pendingSaves = new Map(); // relative path -> debounce timeout

function logSave(relativePath) {
  auditLog
    .record({ module: 'Code Editor', action: 'file.save', entityType: 'File', meta: { file: relativePath } })
    .catch(() => {});
}

function onFsEvent(absDir, filename) {
  if (!filename) return;
  const rel = path.join(path.relative(WORKSPACE_ROOT, absDir), filename).split(path.sep).join('/');
  const top = rel.split('/')[0];
  if (EXCLUDE_TOP_LEVEL.has(top) || top.startsWith('.')) return;

  if (pendingSaves.has(rel)) clearTimeout(pendingSaves.get(rel));
  pendingSaves.set(
    rel,
    setTimeout(() => {
      pendingSaves.delete(rel);
      fs.stat(path.join(WORKSPACE_ROOT, rel), (err, stat) => {
        if (err || !stat.isFile()) return; // deleted/renamed away, or a directory event
        logSave(rel);
      });
    }, DEBOUNCE_MS)
  );
}

function startWatching() {
  if (watchers.length) return;
  let entries;
  try {
    entries = fs.readdirSync(WORKSPACE_ROOT, { withFileTypes: true });
  } catch (e) {
    console.error('[code-editor] cannot read workspace root', WORKSPACE_ROOT, e.message);
    return;
  }
  entries
    .filter((e) => e.isDirectory() && !EXCLUDE_TOP_LEVEL.has(e.name) && !e.name.startsWith('.'))
    .forEach((e) => {
      const absDir = path.join(WORKSPACE_ROOT, e.name);
      try {
        watchers.push(fs.watch(absDir, { recursive: true }, (eventType, filename) => onFsEvent(absDir, filename)));
      } catch (err) {
        console.error('[code-editor] watch failed for', absDir, err.message);
      }
    });
}

function stopWatching() {
  watchers.forEach((w) => w.close());
  watchers = [];
  pendingSaves.forEach((t) => clearTimeout(t));
  pendingSaves.clear();
}

function startCodeEditorFileAuditTick() {
  setInterval(async () => {
    if (mongoose.connection.readyState !== 1) return;
    try {
      const CodeEditorTicket = require('../models/internal/CodeEditorTicket');
      const activeCount = await CodeEditorTicket.countDocuments({
        sessionToken: { $exists: true },
        expiresAt: { $gt: new Date() },
      });
      if (activeCount > 0) startWatching();
      else stopWatching();
    } catch (err) {
      console.error('codeEditorFileAuditTick job error:', err.message);
    }
  }, TICK_MS);
}

// Called directly from codeEditorController on ticket redemption so a save
// made in the first minute of a brand-new session (before the tick above
// would otherwise have noticed) still gets watched, instead of waiting out
// the full TICK_MS poll interval.
module.exports = startCodeEditorFileAuditTick;
module.exports.ensureWatching = startWatching;
