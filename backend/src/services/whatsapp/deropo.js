// DeroPo WhatsApp API client — the ONLY file that talks to DeroPo.
//
// The access token stays on the server (env DEROPO_ACCESS_TOKEN); the browser
// never sees it — QR images are proxied through /api/whatsapp/device/qr.
//
// Endpoint shapes follow the DeroPo guide we were given:
//   POST /api/device/create        { name, phone_number }  → data.device_id
//   GET  /api/device/qr-image?device_id=…                  → PNG
//   GET  /api/device/status?device_id=…                    → data.status
//   POST /api/send                 { number, type, message }
// DeroPo's REST docs (cloud.deropo.com › REST API) name no device on /api/send;
// we also pass `device_id` so DeroPo can send from that user's number. Each
// DeroPo device also has its own API key (/devices/:id/regenerate-api-key) —
// if /api/send ignores device_id, switch sendText to that device's key.
// Webhook payloads: { event: 'message_received', data: { device_id, from, content, … } }
// (see controllers/.../whatsappController/webhook.js).

const BASE_URL = (process.env.DEROPO_BASE_URL || 'https://api.deropo.com').replace(/\/+$/, '');
const TIMEOUT_MS = 20000;

const configured = () => !!process.env.DEROPO_ACCESS_TOKEN;

class DeropoError extends Error {
  constructor(message, status, body) {
    super(message);
    this.status = status;
    this.body = body;
  }
}

async function call(method, path, { query, body, raw } = {}) {
  if (!configured()) throw new DeropoError('WhatsApp is not set up on the server (DEROPO_ACCESS_TOKEN is missing).', 503);
  const url = new URL(BASE_URL + path);
  Object.entries(query || {}).forEach(([k, v]) => v != null && url.searchParams.set(k, String(v)));

  const res = await fetch(url, {
    method,
    headers: {
      'X-Access-Token': process.env.DEROPO_ACCESS_TOKEN,
      ...(body ? { 'Content-Type': 'application/json' } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
    signal: AbortSignal.timeout(TIMEOUT_MS),
  });

  if (raw && res.ok) return res;

  const text = await res.text();
  let json = null;
  try {
    json = text ? JSON.parse(text) : null;
  } catch (_) {
    /* non-JSON error page */
  }
  if (!res.ok || (json && json.success === false)) {
    const msg = (json && (json.message || json.error)) || `DeroPo returned HTTP ${res.status}`;
    throw new DeropoError(msg, res.status, json || text);
  }
  return json || {};
}

// DeroPo statuses we map onto ours: anything "connected"/"open"/"online" is
// connected, "connecting"/"qr"/"pending" is waiting for a scan, rest is down.
function normaliseStatus(s) {
  const v = String(s || '').toLowerCase();
  if (['connected', 'open', 'online', 'authenticated', 'ready'].includes(v)) return 'connected';
  if (['connecting', 'qr', 'pending', 'scan', 'initializing', 'starting'].includes(v)) return 'connecting';
  return 'disconnected';
}

// Numbers go to DeroPo as digits only, with country code (91… for India).
function normaliseNumber(n) {
  let d = String(n || '').replace(/\D/g, '');
  if (d.length === 10) d = '91' + d;
  return d;
}

async function createDevice({ name, phoneNumber }) {
  const json = await call('POST', '/api/device/create', {
    body: { name, phone_number: normaliseNumber(phoneNumber) },
  });
  const data = json.data || json;
  if (data.device_id == null) throw new DeropoError('DeroPo did not return a device id.', 502, json);
  return { deviceId: String(data.device_id), status: normaliseStatus(data.status || 'connecting') };
}

async function getQrImage(deviceId) {
  const res = await call('GET', '/api/device/qr-image', { query: { device_id: deviceId }, raw: true });
  const type = res.headers.get('content-type') || 'image/png';
  // DeroPo docs: 200 + PNG = QR ready; 202 + transparent pixel = still being
  // generated (poll again in 3s); X-QR-Status: ready | pending | connected.
  const qrStatus = String(res.headers.get('x-qr-status') || '').toLowerCase();
  if (res.status === 202 || qrStatus === 'pending') throw new DeropoError('QR code is being generated — it will show in a few seconds.', 409);
  if (qrStatus === 'connected') throw new DeropoError('This number is already connected.', 409);
  if (!type.startsWith('image/')) {
    // Already connected (or not ready yet) — DeroPo answers with JSON instead of a PNG.
    const text = await res.text();
    let json = null;
    try {
      json = JSON.parse(text);
    } catch (_) {
      /* ignore */
    }
    throw new DeropoError((json && json.message) || 'QR code is not available right now.', 409, json || text);
  }
  return { type, buffer: Buffer.from(await res.arrayBuffer()) };
}

async function getStatus(deviceId) {
  const json = await call('GET', '/api/device/status', { query: { device_id: deviceId } });
  const data = json.data || json;
  return { status: normaliseStatus(data.status), phoneNumber: data.phone_number ? String(data.phone_number) : undefined };
}

async function sendText({ deviceId, number, message }) {
  const json = await call('POST', '/api/send', {
    body: { device_id: deviceId, number: normaliseNumber(number), type: 'text', message },
  });
  const data = json.data || json;
  return { providerMessageId: data.message_id || data.id || data.messageId || null };
}

module.exports = { configured, createDevice, getQrImage, getStatus, sendText, normaliseNumber, normaliseStatus, DeropoError };
