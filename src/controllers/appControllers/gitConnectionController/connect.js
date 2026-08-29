const jwt = require('jsonwebtoken');
const { buildOAuthDialogUrl } = require('../../../utils/githubClient');

// repo: full read/write on repos this account can access (needed to create
// repos and to eventually show private repos). read:org: list org repos the
// account belongs to, for "All Repositories". read:user + user:email: identity.
const SCOPE = 'repo read:org read:user user:email';

// GET /api/git/connect (authenticated) — mints a short-lived `state`
// identifying the connecting admin (this app's frontend auth is bearer-token,
// not cookies, so the OAuth callback can't rely on session/auth middleware —
// state is how it knows who initiated the flow) and returns the GitHub OAuth
// dialog URL for the frontend to open in a popup. Mirrors googleController/connect.js.
const connect = async (req, res) => {
  if (!process.env.GITHUB_CLIENT_ID || !process.env.GITHUB_REDIRECT_URI) {
    return res.status(400).json({
      success: false,
      result: null,
      message:
        "GitHub isn't configured yet — add GITHUB_CLIENT_ID and GITHUB_CLIENT_SECRET to backend/.env from a GitHub OAuth App, then restart the server.",
    });
  }

  const state = jwt.sign({ adminId: req.admin._id, purpose: 'github-oauth' }, process.env.JWT_SECRET, {
    expiresIn: '10m',
  });

  const url = buildOAuthDialogUrl({
    redirectUri: process.env.GITHUB_REDIRECT_URI,
    state,
    scope: SCOPE,
  });

  return res.status(200).json({ success: true, result: { url }, message: 'GitHub OAuth URL generated' });
};

module.exports = connect;
