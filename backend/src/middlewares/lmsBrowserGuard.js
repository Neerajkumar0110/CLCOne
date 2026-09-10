// Mounted immediately BEFORE the bearer gate on /api/lms (see app.js).
//
// Problem: when someone opens an /api/lms/... URL directly in a browser tab
// (an old emailed link, a bookmarked API URL, a copy-pasted address), the tab
// has no Authorization header, so adminAuth.isValidAuthToken answers with raw
//   {"success":false,"message":"No authentication token…","jwtExpired":true}
// which looks broken to a non-technical user.
//
// This guard intercepts ONLY genuine browser navigations — a GET whose Accept
// header prefers HTML — that arrive without a bearer token, and serves a small
// friendly page that points back into the app. Everything else is untouched:
//   • the frontend's axios calls send `Accept: application/json …` and a
//     bearer token → fall straight through to the normal auth middleware;
//   • non-GET requests, and GETs that ask for JSON, also fall through;
//   • a GET that DOES carry an Authorization header falls through so the real
//     auth (and its own error messages) still applies.
// Purely additive — it never calls next() with an error and never changes a
// successful request.

function wantsHtml(req) {
  // express: returns the best match, or false. Browsers send
  // "text/html,application/xhtml+xml,...," so html wins; axios sends
  // "application/json, text/plain, */*" so json wins.
  return req.accepts(['json', 'html']) === 'html';
}

function friendlyPage(res, title, body) {
  return res
    .status(200)
    .type('html')
    .send(
      `<!doctype html><meta charset="utf-8">` +
        `<meta name="viewport" content="width=device-width,initial-scale=1">` +
        `<title>${title}</title>` +
        `<div style="font:16px/1.6 system-ui,-apple-system,Segoe UI,Roboto,sans-serif;` +
        `max-width:520px;margin:56px auto;padding:0 20px;color:#17202c">` +
        `<h2 style="margin:0 0 8px">${title}</h2>` +
        `<p>${body}</p>` +
        `<p><a href="/#/lms/classes" style="color:#2f5fd0;font-weight:600">Open Live Classes &rarr;</a></p>` +
        `</div>`
    );
}

module.exports = function lmsBrowserGuard(req, res, next) {
  const authHeader = req.headers['authorization'] || '';
  const hasBearer = authHeader.toLowerCase().startsWith('bearer ') && authHeader.split(' ')[1];

  if (req.method === 'GET' && !hasBearer && wantsHtml(req)) {
    // A plain browser hit with no token. For the live-class "open" links we can
    // still route them through the token-in-query flow; otherwise just explain.
    const m = req.path.match(/^\/(?:live-?classes)\/([a-f0-9]{24})\/open\/?$/i);
    if (m && (req.query.t || req.query.token)) {
      const q = req.query.t || req.query.token;
      return res.redirect(302, `/api/lms/live/open/${m[1]}?t=${encodeURIComponent(q)}`);
    }
    return friendlyPage(
      res,
      'Sign in required',
      'This is an internal address. Open the CRM, go to <b>LMS &rarr; Live Classes</b> and click <b>Join</b> on your class.'
    );
  }

  return next();
};
