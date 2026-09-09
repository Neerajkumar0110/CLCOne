const crypto = require('crypto');
const jwt = require('jsonwebtoken');
const { lmsConfig } = require('../../config/lms');

// Mint the short-lived, single-use JWT that local_crmsso exchanges for a
// Moodle session. The CRM is the identity provider — Moodle never shows a
// login form to a normal user.
//
// Claims:
//   iss  clc-crm            (MOODLE_SSO_ISSUER)
//   aud  moodle             (MOODLE_SSO_AUDIENCE)
//   sub  <CRM Admin _id>    → resolved on the Moodle side via user.idnumber
//   jti  <random>           → single-use nonce (local_crmsso caches spent jtis)
//   eml, name, role         → so local_crmsso can keep the account in step
//   wantsurl                → where to land after login (relative to Moodle)
//   exp  now + 60s

function mintLoginToken({ crmUserId, email, name, lmsRole, wantsurl } = {}) {
  const { secret, tokenTtlSec, issuer, audience } = lmsConfig.sso;
  if (!secret) throw new Error('SSO is not configured (MOODLE_SSO_SECRET).');

  const payload = {
    iss: issuer,
    aud: audience,
    sub: String(crmUserId),
    jti: crypto.randomBytes(16).toString('hex'),
    eml: email || undefined,
    name: name || undefined,
    role: lmsRole || 'student',
    wantsurl: wantsurl || '/my/',
  };
  return jwt.sign(payload, secret, { algorithm: 'HS256', expiresIn: tokenTtlSec });
}

// Full URL the browser is redirected to.
function buildLoginUrl(token) {
  const { baseUrl } = lmsConfig.moodle;
  const { loginPath } = lmsConfig.sso;
  return `${baseUrl}${loginPath}?token=${encodeURIComponent(token)}`;
}

function buildLogoutUrl() {
  const { baseUrl } = lmsConfig.moodle;
  return `${baseUrl}${lmsConfig.sso.logoutPath}`;
}

// Only used in tests / a local echo endpoint — Moodle verifies for real.
function verifyLoginToken(token) {
  const { secret, issuer, audience } = lmsConfig.sso;
  return jwt.verify(token, secret, { algorithms: ['HS256'], issuer, audience });
}

module.exports = { mintLoginToken, buildLoginUrl, buildLogoutUrl, verifyLoginToken };
