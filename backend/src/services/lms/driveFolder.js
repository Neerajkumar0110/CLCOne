const fs = require('fs');
const mongoose = require('mongoose');
const { pipeline } = require('stream/promises');
const { Readable } = require('stream');
const google = require('../../utils/googleAdsClient');
const tokenCrypto = require('../../utils/googleTokenCrypto');
const { downloadDriveFileTo } = require('./driveImport');

// Google Drive access for Recordings → "Import from Drive": list the videos
// in a folder and download one to disk. Reads through the connected Google
// account (LmsDriveConnection — same OAuth client as Google Ads, read-only
// Drive scope), so private folders work. With no account connected it
// falls back to Drive's public pages, which only work for a folder shared
// as "Anyone with the link".

const SCOPE = 'https://www.googleapis.com/auth/drive.readonly openid email';
const API = 'https://www.googleapis.com/drive/v3';
const VIDEO_EXT = /\.(mp4|mkv|mov|webm|m4v|avi)$/i;

// Google sends the popup back to this server's own /public/google/callback.
// DRIVE_OAUTH_REDIRECT_URI exists because GOOGLE_ADS_REDIRECT_URI may point
// at another deployment; whichever is used must be listed under the OAuth
// client's "Authorized redirect URIs" in Google Cloud.
const redirectUri = () => process.env.DRIVE_OAUTH_REDIRECT_URI || process.env.GOOGLE_ADS_REDIRECT_URI;
const isConfigured = () => !!(process.env.GOOGLE_ADS_CLIENT_ID && process.env.GOOGLE_ADS_CLIENT_SECRET && redirectUri());

async function getConnection() {
  return mongoose.model('LmsDriveConnection').findOne({ removed: false }).sort({ updated: -1 });
}

// Saves the account that just finished the OAuth popup (called from the
// shared /public/google/callback when state.purpose === 'google-drive').
async function saveConnection({ code, adminName }) {
  const tokens = await google.exchangeCodeForToken({ code, redirectUri: redirectUri() });
  if (!tokens.refresh_token) {
    throw new Error("Google did not return a refresh token — remove this app at https://myaccount.google.com/permissions and connect again.");
  }
  const me = await google.getUserInfo(tokens.access_token);
  const Conn = mongoose.model('LmsDriveConnection');
  await Conn.updateMany({ removed: false }, { $set: { removed: true, updated: new Date() } });
  await Conn.create({
    googleUserId: me.sub || me.id,
    googleUserEmail: me.email,
    refreshToken: tokenCrypto.encrypt(tokens.refresh_token),
    accessToken: tokenCrypto.encrypt(tokens.access_token),
    tokenExpiresAt: tokens.expires_in ? new Date(Date.now() + tokens.expires_in * 1000) : undefined,
    connectedBy: adminName,
  });
  return me.email;
}

async function accessToken() {
  const conn = await getConnection();
  if (!conn) return null;
  const fresh = conn.tokenExpiresAt && conn.tokenExpiresAt.getTime() - Date.now() > 5 * 60 * 1000;
  if (fresh && conn.accessToken) return tokenCrypto.decrypt(conn.accessToken);
  try {
    const t = await google.refreshAccessToken({ refreshToken: tokenCrypto.decrypt(conn.refreshToken) });
    conn.accessToken = tokenCrypto.encrypt(t.access_token);
    conn.tokenExpiresAt = new Date(Date.now() + (t.expires_in || 3600) * 1000);
    conn.lastError = undefined;
    conn.updated = new Date();
    await conn.save();
    return t.access_token;
  } catch (e) {
    conn.lastError = e.message;
    await conn.save().catch(() => {});
    throw new Error(`Google Drive connection has expired (${e.message}) — click "Connect Google Drive" again.`);
  }
}

async function driveGet(pathAndQuery, token) {
  const res = await fetch(`${API}${pathAndQuery}`, { headers: { Authorization: `Bearer ${token}` } });
  const json = await res.json().catch(() => ({}));
  if (!res.ok) {
    const msg = (json.error && json.error.message) || `Google Drive returned HTTP ${res.status}`;
    if (res.status === 404) throw new Error('Folder not found — check the link, and that the connected Google account can open it.');
    throw new Error(msg);
  }
  return json;
}

function extractFolderId(input) {
  const s = String(input || '').trim();
  let m = /\/folders\/([\w-]{10,})/.exec(s);
  if (m) return m[1];
  m = /[?&]id=([\w-]{10,})/.exec(s);
  if (m) return m[1];
  if (/^[\w-]{20,}$/.test(s)) return s;
  return null;
}

// ── listing ─────────────────────────────────────────────────────────────

async function listWithApi(folderId, token) {
  const meta = await driveGet(`/files/${encodeURIComponent(folderId)}?fields=id,name,mimeType&supportsAllDrives=true`, token);
  if (meta.mimeType !== 'application/vnd.google-apps.folder') throw new Error('That link is a file, not a folder — paste the folder link.');
  const out = [];
  const stack = [{ id: folderId, path: '' }];
  while (stack.length) {
    const { id, path } = stack.pop();
    let pageToken = '';
    do {
      const q = encodeURIComponent(`'${id}' in parents and trashed=false`);
      const fields = encodeURIComponent('nextPageToken,files(id,name,mimeType,size,createdTime,videoMediaMetadata(durationMillis))');
      const r = await driveGet(
        `/files?q=${q}&fields=${fields}&pageSize=200&supportsAllDrives=true&includeItemsFromAllDrives=true${pageToken ? `&pageToken=${pageToken}` : ''}`,
        token
      );
      for (const f of r.files || []) {
        if (f.mimeType === 'application/vnd.google-apps.folder') stack.push({ id: f.id, path: `${path}${f.name}/` });
        else if ((f.mimeType || '').startsWith('video/') || VIDEO_EXT.test(f.name)) {
          out.push({
            fileId: f.id,
            name: f.name,
            path,
            size: f.size ? Number(f.size) : 0,
            durationSec: f.videoMediaMetadata && f.videoMediaMetadata.durationMillis ? Math.round(Number(f.videoMediaMetadata.durationMillis) / 1000) : 0,
          });
        }
      }
      pageToken = r.nextPageToken || '';
    } while (pageToken);
  }
  return { folder: { id: folderId, name: meta.name }, files: out };
}

// Drive's embeddable folder page — public ("Anyone with the link") folders
// only, and no sizes/durations. Used only when no account is connected.
async function listPublic(folderId) {
  const out = [];
  let folderName = '';
  const stack = [{ id: folderId, path: '' }];
  const seen = new Set();
  while (stack.length) {
    const { id, path } = stack.pop();
    if (seen.has(id)) continue;
    seen.add(id);
    const res = await fetch(`https://drive.google.com/embeddedfolderview?id=${encodeURIComponent(id)}`);
    const html = res.ok ? await res.text() : '';
    if (!html.includes('flip-entry')) {
      if (id === folderId) {
        throw new Error('Could not open this folder. Connect Google Drive (button above), or share the folder as "Anyone with the link".');
      }
      continue;
    }
    if (id === folderId) {
      const t = /<title>([^<]*)<\/title>/.exec(html);
      folderName = t ? t[1].trim() : '';
    }
    const re = /<div class="flip-entry" id="entry-([\w-]+)"[\s\S]*?<a href="([^"]+)"[\s\S]*?<div class="flip-entry-title">([^<]*)<\/div>/g;
    let m;
    while ((m = re.exec(html))) {
      const [, fid, href, rawName] = m;
      const name = rawName.replace(/&amp;/g, '&').replace(/&#39;/g, "'").replace(/&quot;/g, '"').trim();
      if (/\/folders\//.test(href)) stack.push({ id: fid, path: `${path}${name}/` });
      else if (VIDEO_EXT.test(name)) out.push({ fileId: fid, name, path, size: 0, durationSec: 0 });
    }
  }
  return { folder: { id: folderId, name: folderName }, files: out };
}

async function listFolderVideos(folderId) {
  const token = await accessToken();
  if (token) return { ...(await listWithApi(folderId, token)), via: 'account' };
  return { ...(await listPublic(folderId)), via: 'public' };
}

// ── download ────────────────────────────────────────────────────────────

async function downloadTo(fileId, destPath) {
  const token = await accessToken();
  if (!token) return downloadDriveFileTo(fileId, destPath);
  const res = await fetch(`${API}/files/${encodeURIComponent(fileId)}?alt=media&supportsAllDrives=true&acknowledgeAbuse=true`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!res.ok) {
    const json = await res.json().catch(() => ({}));
    throw new Error((json.error && json.error.message) || `Google Drive returned HTTP ${res.status} for this file.`);
  }
  await pipeline(Readable.fromWeb(res.body), fs.createWriteStream(destPath));
}

// ── class date from the file name ───────────────────────────────────────
// e.g. "8to930(23-sep-2026-8_00_pm-9_30_pm) (1440p).mp4", "Class 23 Sep 2026.mp4",
// "Sep 23, 2026.mp4", "2026-09-23 class.mp4", "23-09-2026.mp4", "23.09.2026.mp4".
const MONTHS = { jan: 1, feb: 2, mar: 3, apr: 4, may: 5, jun: 6, jul: 7, aug: 8, sep: 9, oct: 10, nov: 11, dec: 12 };
const MON = '(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*';

function key(y, mo, d) {
  y = Number(y);
  mo = Number(mo);
  d = Number(d);
  if (y < 2000 || y > 2100 || mo < 1 || mo > 12 || d < 1 || d > 31) return null;
  const dt = new Date(Date.UTC(y, mo - 1, d));
  if (dt.getUTCMonth() !== mo - 1) return null; // 31-sep etc.
  return `${y}-${String(mo).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
}

function dateKeyFromName(name) {
  const s = String(name || '');
  let m = new RegExp(`(?:^|[^0-9])(\\d{1,2})(?:st|nd|rd|th)?[-_ .]{0,2}${MON}[-_ .,]{0,2}(\\d{4})`, 'i').exec(s);
  if (m) return key(m[3], MONTHS[m[2].toLowerCase()], m[1]);
  m = new RegExp(`${MON}[-_ .]{0,2}(\\d{1,2})(?:st|nd|rd|th)?[-_ .,]{0,3}(\\d{4})`, 'i').exec(s);
  if (m) return key(m[3], MONTHS[m[1].toLowerCase()], m[2]);
  m = /(?:^|[^0-9])(20\d{2})[-_.](\d{1,2})[-_.](\d{1,2})(?:[^0-9]|$)/.exec(s);
  if (m) return key(m[1], m[2], m[3]);
  m = /(?:^|[^0-9])(\d{1,2})[-_.](\d{1,2})[-_.](20\d{2})(?:[^0-9]|$)/.exec(s);
  if (m) return key(m[3], m[2], m[1]);
  m = /(?:^|[^0-9])(20\d{2})(\d{2})(\d{2})(?:[^0-9]|$)/.exec(s);
  if (m) return key(m[1], m[2], m[3]);
  return null;
}

module.exports = {
  SCOPE,
  redirectUri,
  isConfigured,
  getConnection,
  saveConnection,
  extractFolderId,
  listFolderVideos,
  downloadTo,
  dateKeyFromName,
};
