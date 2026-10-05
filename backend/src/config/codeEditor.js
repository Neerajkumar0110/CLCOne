// How long a one-time join ticket stays redeemable before it expires unused.
const TICKET_TTL_SEC = 30;

// Idle timeout for an open editor session (design rule: idle sessions must
// time out automatically) — slides forward on every nginx auth_request hit
// while the iframe is actually active, so a session stays open through
// normal use and only expires once it's genuinely been left idle.
const IDLE_TIMEOUT_SEC = parseInt(process.env.CODE_EDITOR_IDLE_TIMEOUT_SEC || '1800', 10);

// Public origin to build the embeddable editor URL against. Falls back to
// the request's own Host header (see codeEditorController) when unset,
// which is fine locally but should be set explicitly in prod so the ticket
// URL always points at the real public domain regardless of how the
// backend process itself was reached.
const PUBLIC_BASE = process.env.CODE_EDITOR_PUBLIC_BASE || '';

module.exports = { TICKET_TTL_SEC, IDLE_TIMEOUT_SEC, PUBLIC_BASE };
