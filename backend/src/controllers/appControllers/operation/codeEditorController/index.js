const crypto = require('crypto');
const CodeEditorTicket = require('../../../../models/internal/CodeEditorTicket');
const codeEditorAccess = require('../../../../services/access/codeEditorAccess');
const auditLog = require('../../../../services/lms/auditLog');
const fileAuditTick = require('../../../../jobs/codeEditorFileAuditTick');
const { TICKET_TTL_SEC, IDLE_TIMEOUT_SEC, PUBLIC_BASE } = require('../../../../config/codeEditor');

function publicBase(req) {
  return PUBLIC_BASE || `${req.protocol}://${req.get('host')}`;
}

// POST /api/code-editor/session — bearer-gated (mounted with
// adminAuth.isValidAuthToken in app.js, same as /api/git and /api/vercel).
// Issues a one-time ticket that bootstraps a cookie-backed editor session
// via nginx's auth_request on the VPS. Never a hardcoded bypass: every
// admin, owner included, needs a real Permission grant (see
// codeEditorAccess) or this returns 403.
async function createSession(req, res) {
  const grant = await codeEditorAccess.getGrant(req.admin);
  if (!grant.view) {
    return res.status(403).json({
      success: false,
      result: null,
      message: "You don't have Code Editor access. Ask an admin to grant it from Roles & Permissions.",
    });
  }

  const ticket = crypto.randomBytes(20).toString('hex');
  await CodeEditorTicket.create({
    ticket,
    admin: req.admin._id,
    createdIp: req.ip,
    expiresAt: new Date(Date.now() + TICKET_TTL_SEC * 1000),
  });

  await auditLog.record({
    module: 'Code Editor',
    action: 'session.start',
    entityType: 'CodeEditorSession',
    admin: req.admin,
    meta: { ip: req.ip },
  });

  return res.json({
    success: true,
    result: {
      url: `${publicBase(req)}/code-editor/?ticket=${ticket}`,
      expiresInSec: TICKET_TTL_SEC,
    },
  });
}

// GET /api/code-editor/auth — called ONLY by nginx's `auth_request` on the
// VPS (the nginx location proxying it is marked `internal;`), never
// reachable directly from a browser. No bearer token is available here: a
// plain iframe navigation can't attach an Authorization header, so this
// validates either the one-time ticket (first hit, forwarded by nginx as
// X-CE-Ticket from the original request's ?ticket= query arg) or the
// session cookie nginx already received on every hit after that.
async function authCheck(req, res) {
  const cookieToken = req.cookies && req.cookies.ce_session;
  const ticketStr = req.headers['x-ce-ticket'];

  if (cookieToken) {
    const doc = await CodeEditorTicket.findOne({ sessionToken: cookieToken, expiresAt: { $gt: new Date() } });
    if (!doc) return res.status(401).end();
    doc.expiresAt = new Date(Date.now() + IDLE_TIMEOUT_SEC * 1000); // sliding idle timeout
    await doc.save();
    return res.status(200).end();
  }

  if (ticketStr) {
    const doc = await CodeEditorTicket.findOne({ ticket: ticketStr, used: false, expiresAt: { $gt: new Date() } });
    if (!doc) return res.status(401).end();
    doc.used = true;
    doc.sessionToken = crypto.randomBytes(24).toString('hex');
    doc.expiresAt = new Date(Date.now() + IDLE_TIMEOUT_SEC * 1000);
    await doc.save();
    fileAuditTick.ensureWatching();

    res.cookie('ce_session', doc.sessionToken, {
      httpOnly: true,
      secure: true,
      sameSite: 'lax',
      path: '/code-editor/',
      maxAge: IDLE_TIMEOUT_SEC * 1000,
    });
    return res.status(200).end();
  }

  return res.status(401).end();
}

module.exports = { createSession, authCheck };
