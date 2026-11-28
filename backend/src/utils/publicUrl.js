// The public address put into emails and links sent to people (user ask
// 2026-11-28: a link someone receives must never point at a laptop / local
// server). Any env value that is localhost / 127.0.0.1 / a private or bare IP
// is ignored and the live domain is used instead.
const LIVE = 'https://clcone.careerlabconsulting.com';

function isLocal(u) {
  try {
    const h = new URL(u).hostname;
    return h === 'localhost' || h.endsWith('.local') || /^(127\.|10\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.|0\.0\.0\.0)/.test(h) || /^\d+\.\d+\.\d+\.\d+$/.test(h);
  } catch (e) {
    return true; // not a URL at all
  }
}

// first usable candidate, else the live domain; no trailing slash
function publicUrl(...candidates) {
  for (const c of candidates) {
    const v = String(c || '').trim().replace(/\/+$/, '');
    if (v && !isLocal(v)) return v;
  }
  return LIVE;
}

module.exports = { publicUrl, isLocal, LIVE };
