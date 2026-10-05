const fs = require('fs');
const { pipeline } = require('stream/promises');
const { Readable } = require('stream');

// Pulls a Google Drive file's actual bytes down to disk — used to re-host a
// recording that was only ever linked (not uploaded) on the CRM's own
// server, because Drive's embeddable /preview page is unreliable as a
// player: it depends on the *viewer's* browser having a Google session /
// third-party cookies allowed, so "No preview available" shows up even when
// the file's sharing is correctly set to "Anyone with the link". A real
// download + <video> tag has none of that dependency.
//
// Handles Drive's "can't scan this file for viruses" interstitial, which
// Drive serves instead of the file itself for anything past a size
// threshold — the real bytes are one more request away, with a `confirm`
// token pulled out of that interstitial page.
async function fetchDriveFile(fileId) {
  const base = 'https://drive.google.com/uc?export=download';
  let res = await fetch(`${base}&id=${encodeURIComponent(fileId)}`, { redirect: 'follow' });
  const firstType = res.headers.get('content-type') || '';

  if (firstType.includes('text/html')) {
    const html = await res.text();
    const tokenMatch =
      /confirm=([0-9A-Za-z_-]+)/.exec(html) || /name="confirm"\s+value="([0-9A-Za-z_-]+)"/.exec(html);
    const confirm = tokenMatch ? tokenMatch[1] : 't';
    const setCookie = res.headers.get('set-cookie') || '';
    const cookieMatch = /download_warning[0-9A-Za-z_]*=([0-9A-Za-z_-]+)/.exec(setCookie);
    const headers = cookieMatch ? { Cookie: `download_warning=${cookieMatch[1]}` } : {};
    res = await fetch(`${base}&id=${encodeURIComponent(fileId)}&confirm=${confirm}`, {
      redirect: 'follow',
      headers,
    });
  }

  if (!res.ok) throw new Error(`Google Drive returned HTTP ${res.status} for this file.`);
  const finalType = res.headers.get('content-type') || '';
  if (finalType.includes('text/html')) {
    throw new Error(
      "Google Drive didn't return the file itself — it's likely not shared as \"Anyone with the link\", or the link is wrong/deleted."
    );
  }
  if (!res.body) throw new Error('Google Drive returned an empty response.');
  return res;
}

async function downloadDriveFileTo(fileId, destPath) {
  const res = await fetchDriveFile(fileId);
  await pipeline(Readable.fromWeb(res.body), fs.createWriteStream(destPath));
}

// Accepts any of the URL shapes normalizeExternalRecordingUrl (liveScope.js)
// produces or was ever given, and pulls the Drive file id out of it.
function extractDriveFileId(url) {
  const str = String(url || '');
  let m = /\/file\/d\/([^/?]+)/.exec(str);
  if (m) return m[1];
  m = /[?&]id=([^&]+)/.exec(str);
  if (m) return m[1];
  return null;
}

module.exports = { downloadDriveFileTo, extractDriveFileId };
