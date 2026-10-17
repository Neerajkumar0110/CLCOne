const crypto = require('crypto');
const mongoose = require('mongoose');
const { callingConfig } = require('../../config/calling');

// How an Instant Lead Pool customer who answers reaches the agent. Admin /
// Super Admin switch it on the Calls page (CallCampaign.leadPoolConnectMode);
// 'classic' is the original flow and stays the default.
//
//   classic  — customer answers → greeting → agent's mobile rings for THIS
//              call (plivoAnswer.js bridgeToNumber). Unchanged.
//   alwaysOn — when the agent joins the pool, their mobile is called ONCE
//              and they sit in their own conference room `agent-<id>`.
//              A customer who answers is put straight into that room — the
//              agent is already there, no ring, no greeting.
//   browser  — the agent takes calls in the CRM tab through a Plivo SIP
//              endpoint (browser SDK, auto-answer). Same conference bridge
//              as classic, but the far leg is `sip:<endpoint>` and there's
//              no greeting since it picks up in ~1s.
//
// Only Instant Lead Pool calls (and instant Facebook-lead calls) use these
// modes. A manual Dialer / callback call always rings the mobile (classic).
const MODES = ['classic', 'alwaysOn', 'browser'];
const BROWSER_READY_MS = 75 * 1000; // heartbeat every 30s from the tab

const p = () => callingConfig.cloud.plivo;
const authHeaders = () => ({
  Authorization: `Basic ${Buffer.from(`${p().authId}:${p().authToken}`).toString('base64')}`,
  'Content-Type': 'application/json',
  Accept: 'application/json',
});
const secretQs = () => {
  const s = callingConfig.cloud.webhookSecret;
  return s ? `&secret=${encodeURIComponent(s)}` : '';
};

let _modeCache = { at: 0, mode: 'classic' };
async function getConnectMode({ fresh = false } = {}) {
  if (!fresh && Date.now() - _modeCache.at < 10000) return _modeCache.mode;
  const camp = await mongoose
    .model('CallCampaign')
    .findOne({ isLeadPool: true, removed: false })
    .select('leadPoolConnectMode')
    .lean();
  const mode = (camp && MODES.includes(camp.leadPoolConnectMode) && camp.leadPoolConnectMode) || 'classic';
  _modeCache = { at: Date.now(), mode };
  return mode;
}
function clearModeCache() {
  _modeCache = { at: 0, mode: 'classic' };
}

// Extra AgentCallState filter: who can actually take a pool customer right
// now in this mode (line up / browser phone registered).
function eligibleAgentFilter(mode) {
  if (mode === 'alwaysOn') return { agentLineLive: true };
  if (mode === 'browser') return { browserReadyAt: { $gte: new Date(Date.now() - BROWSER_READY_MS) } };
  return {};
}

const agentRoom = (agentId) => `agent-${agentId}`;

// ── alwaysOn: the agent's standing line ──────────────────────────────────
async function startAgentLine(admin) {
  const { last10 } = require('./callingShared');
  const number = last10(admin.phone || admin.mobile || admin.contactNumber);
  if (!number || !p().authId) return { ok: false, error: 'No phone number on this user.' };
  const base = `${p().publicBaseUrl}/api/cloud-call/plivo-answer?agentId=${admin._id}`;
  const res = await fetch(`${p().apiBase}/v1/Account/${p().authId}/Call/`, {
    method: 'POST',
    headers: authHeaders(),
    body: JSON.stringify({
      from: callingConfig.cloud.callerId,
      to: `${p().countryCode}${number}`,
      answer_url: `${base}&leg=agent-line${secretQs()}`,
      answer_method: 'POST',
      hangup_url: `${base}&leg=agent-line-hangup${secretQs()}`,
      hangup_method: 'POST',
      ring_timeout: 45,
    }),
  }).catch((e) => ({ ok: false, statusText: e.message }));
  if (!res || !res.ok) return { ok: false, error: `Could not call your phone (${res && (res.status || res.statusText)}).` };
  const json = await res.json().catch(() => ({}));
  const requestId = Array.isArray(json.request_uuid) ? json.request_uuid[0] : json.request_uuid;
  await mongoose.model('AgentCallState').updateOne(
    { agent: admin._id },
    { $set: { agentLineRequestId: requestId || null, agentLineCallUuid: null, agentLineLive: false, agentLineAt: new Date() } }
  );
  return { ok: true };
}

async function stopAgentLine(agentId) {
  const st = await mongoose
    .model('AgentCallState')
    .findOne({ agent: agentId })
    .select('agentLineCallUuid agentLineRequestId')
    .lean();
  if (!st) return;
  const url = st.agentLineCallUuid
    ? `${p().apiBase}/v1/Account/${p().authId}/Call/${st.agentLineCallUuid}/`
    : st.agentLineRequestId
    ? `${p().apiBase}/v1/Account/${p().authId}/Request/${st.agentLineRequestId}/`
    : null;
  if (url) await fetch(url, { method: 'DELETE', headers: authHeaders() }).catch(() => {});
  await mongoose
    .model('AgentCallState')
    .updateOne({ agent: agentId }, { $set: { agentLineLive: false, agentLineCallUuid: null, agentLineRequestId: null } });
}

// Plivo records the customer's own call (both sides mixed) — alwaysOn has
// no per-call conference to record.
async function recordCustomerCall(rec) {
  if (!rec || !rec.providerCallId) return;
  const cb = `${p().publicBaseUrl}/api/cloud-call/webhook?crmCallId=${rec._id}${secretQs()}`;
  await fetch(`${p().apiBase}/v1/Account/${p().authId}/Call/${rec.providerCallId}/Record/`, {
    method: 'POST',
    headers: authHeaders(),
    body: JSON.stringify({ file_format: 'mp3', callback_url: cb, callback_method: 'POST' }),
  }).catch(() => {});
}

// Actually end the customer's call (the in-call Hang Up button) — needed
// in alwaysOn/browser, where the agent can't just hang up their own phone.
async function hangupCustomer(rec) {
  if (!rec || !rec.providerCallId || String(rec.providerCallId).startsWith('cloud-')) return;
  await fetch(`${p().apiBase}/v1/Account/${p().authId}/Call/${rec.providerCallId}/`, {
    method: 'DELETE',
    headers: authHeaders(),
  }).catch(() => {});
}

// ── browser: one Plivo SIP endpoint per agent ────────────────────────────
function tokenCrypto() {
  return require('../../utils/metaTokenCrypto');
}
async function ensureBrowserEndpoint(admin) {
  const AgentCallState = mongoose.model('AgentCallState');
  const st = await AgentCallState.findOne({ agent: admin._id }).select('plivoEndpoint').lean();
  if (st && st.plivoEndpoint && st.plivoEndpoint.username && st.plivoEndpoint.passwordEnc) {
    return { username: st.plivoEndpoint.username, password: tokenCrypto().decrypt(st.plivoEndpoint.passwordEnc) };
  }
  const password = crypto.randomBytes(12).toString('base64').replace(/[^A-Za-z0-9]/g, '').slice(0, 16) + 'Aa1';
  const wanted = `clc${String(admin._id).slice(-8)}`;
  const res = await fetch(`${p().apiBase}/v1/Account/${p().authId}/Endpoint/`, {
    method: 'POST',
    headers: authHeaders(),
    body: JSON.stringify({ username: wanted, password, alias: `${admin.name || 'Agent'} ${admin.surname || ''}`.trim() }),
  });
  const json = await res.json().catch(() => ({}));
  if (!res.ok || !json.username) throw new Error(json.error || `Plivo endpoint create failed (HTTP ${res.status})`);
  await AgentCallState.updateOne(
    { agent: admin._id },
    {
      $setOnInsert: { agent: admin._id },
      $set: { plivoEndpoint: { id: json.endpoint_id, username: json.username, passwordEnc: tokenCrypto().encrypt(password) } },
    },
    { upsert: true }
  );
  return { username: json.username, password };
}

module.exports = {
  MODES,
  getConnectMode,
  clearModeCache,
  eligibleAgentFilter,
  agentRoom,
  startAgentLine,
  stopAgentLine,
  recordCustomerCall,
  hangupCustomer,
  ensureBrowserEndpoint,
};
