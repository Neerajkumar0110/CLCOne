const { callingConfig } = require('../../config/calling');

// Bi-directional audio streaming (Tata Tele Business Services). Tata's
// platform opens ONE WebSocket connection to us per call and drives the
// exchange with these events, in order:
//   connected -> start -> media* (every ~100ms) -> stop, with dtmf events
//   interspersed whenever the caller presses a touch-tone key.
// We reply with `media` (mulaw/8000 base64 audio) and `mark` events; a
// `clear` we send empties whatever we've queued (e.g. to interrupt/barge-in).
//
// No voicebot logic is wired in yet — this is an ECHO STUB: whatever audio
// a caller sends is queued straight back at them, chunk-numbered, so the
// pipeline (connection, framing, DTMF capture, timing) can be exercised
// end-to-end before a real bot replaces handleMedia() below with actual
// STT/LLM/TTS output.

let wss = null;

function initVoiceStream(server) {
  const cfg = callingConfig.cloud.voiceStream;
  if (!cfg.enabled) return;

  const WebSocket = require('ws');
  wss = new WebSocket.Server({ server, path: cfg.path });

  wss.on('connection', (ws, req) => {
    if (cfg.sharedSecret) {
      const token = new URL(req.url, 'http://internal').searchParams.get('token');
      if (token !== cfg.sharedSecret) {
        ws.close(4001, 'unauthorized');
        return;
      }
    }
    attachStream(ws);
  });

  console.log(`Voice-stream WS server listening at ${cfg.path}`);
}

function attachStream(ws) {
  const state = { streamSid: null, callSid: null, outSeq: 0, outChunk: 0 };

  const send = (payload) => {
    state.outSeq += 1;
    if (ws.readyState === ws.OPEN) {
      ws.send(JSON.stringify({ sequenceNumber: String(state.outSeq), ...payload }));
    }
  };

  ws.on('message', (raw) => {
    let msg;
    try {
      msg = JSON.parse(raw);
    } catch (err) {
      return;
    }

    switch (msg.event) {
      case 'connected':
        break; // handshake only, nothing to reply with

      case 'start': {
        const start = msg.start || {};
        state.streamSid = msg.streamSid || start.streamSid;
        state.callSid = start.callSid;
        console.log(`[voice-stream] start callSid=${state.callSid} direction=${start.direction || '?'}`);
        break;
      }

      case 'media':
        handleMedia(msg, state, send);
        break;

      case 'dtmf':
        console.log(`[voice-stream] dtmf digit=${(msg.dtmf || {}).digit} callSid=${state.callSid}`);
        break;

      case 'mark':
        break; // ack of a mark we sent — nothing to do in the echo stub

      case 'stop':
        console.log(`[voice-stream] stop callSid=${state.callSid} reason=${(msg.stop || {}).reason || ''}`);
        break;

      default:
        break;
    }
  });

  ws.on('error', (err) => {
    console.error('[voice-stream] socket error:', err.message);
  });
}

// Echo stub — bounce the caller's own audio straight back. Replace this
// function with real bot output (STT -> LLM/flow -> TTS) when ready; the
// event framing above (start/stop/dtmf/mark) does not need to change.
function handleMedia(msg, state, send) {
  const payload = msg.media && msg.media.payload;
  if (!payload || !state.streamSid) return;
  state.outChunk += 1;
  send({
    event: 'media',
    streamSid: state.streamSid,
    media: { chunk: state.outChunk, payload },
  });
}

module.exports = { initVoiceStream };
