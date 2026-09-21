const net = require('net');
const { EventEmitter } = require('events');
const crypto = require('crypto');
const config = require('../config');
const { logger } = require('../lib/logger');

// Minimal Asterisk Manager Interface client — no external dependency.
// AMI is a line protocol: "Key: Value\r\n" lines, blank line ends a
// message. We correlate Action ↔ Response with an ActionID.
//
// Connects to 127.0.0.1:5038 ONLY (manager.conf binds localhost). If AMI
// is unreachable the service still runs (status reports offline); calls
// just can't be originated until it's up.

class AmiClient extends EventEmitter {
  constructor() {
    super();
    this.sock = null;
    this.buf = '';
    this.connected = false;
    this.loggedIn = false;
    this.pending = new Map(); // ActionID -> {resolve, reject, timer, lines}
    this._retryMs = 2000;
  }

  connect() {
    if (this.sock) return;
    const { host, port } = config.ami;
    logger.info({ host, port }, 'AMI connecting');
    this.sock = net.createConnection({ host, port }, () => {
      this.connected = true;
      this._retryMs = 2000;
      setTimeout(() => { if (this.sock && !this._loginSent) this._login(); }, 250);
    });
    this.sock.setEncoding('utf8');
    this.sock.on('data', (chunk) => this._onData(chunk));
    this.sock.on('error', (err) => logger.warn({ err: err.message }, 'AMI socket error'));
    this.sock.on('close', () => {
      this.connected = false;
      this.loggedIn = false;
      this._loginSent = false;
      this.sock = null;
      for (const [, p] of this.pending) {
        clearTimeout(p.timer);
        p.reject(new Error('AMI disconnected'));
      }
      this.pending.clear();
      this.emit('disconnected');
      setTimeout(() => this.connect(), this._retryMs);
      this._retryMs = Math.min(this._retryMs * 2, 30_000);
    });
  }

  _onData(chunk) {
    this.buf += chunk;
    if (!this._loginSent && this.buf.indexOf("Asterisk Call Manager") === 0 && this.buf.indexOf(String.fromCharCode(10)) !== -1) this._login();
    let idx;
    while ((idx = this.buf.indexOf('\r\n\r\n')) !== -1) {
      const raw = this.buf.slice(0, idx);
      this.buf = this.buf.slice(idx + 4);
      this._onMessage(this._parse(raw));
    }
  }

  _parse(raw) {
    const msg = {};
    for (const line of raw.split('\r\n')) {
      const c = line.indexOf(':');
      if (c === -1) {
        if (line.startsWith('Asterisk Call Manager')) msg._greeting = line.trim();
        continue;
      }
      const k = line.slice(0, c).trim();
      const v = line.slice(c + 1).trim();
      msg[k] = v;
    }
    return msg;
  }

  _onMessage(msg) {
    if (msg._greeting && !this.loggedIn && !msg.Response && !msg.ActionID) return this._login();

    if (msg.ActionID && this.pending.has(msg.ActionID)) {
      const p = this.pending.get(msg.ActionID);
      // Response messages may be followed by list events + a completion
      // event; for our simple actions the first Response is enough.
      clearTimeout(p.timer);
      this.pending.delete(msg.ActionID);
      if (String(msg.Response).toLowerCase() === 'error') {
        p.reject(new Error(msg.Message || 'AMI error'));
      } else {
        p.resolve(msg);
      }
      return;
    }

    if (msg.Event) this.emit('event', msg);
  }

  _login() {
    if (this._loginSent) return;
    this._loginSent = true;
    const id = this._id();
    this._raw({
      Action: 'Login',
      Username: config.ami.user,
      Secret: config.ami.secret,
      Events: 'call,cdr,cel',
      ActionID: id,
    });
    // Asterisk replies with a Response line for Login.
    const timer = setTimeout(() => logger.warn('AMI login timed out'), 8000);
    this.pending.set(id, {
      resolve: () => {
        clearTimeout(timer);
        this.loggedIn = true;
        logger.info('AMI logged in');
        this.emit('ready');
      },
      reject: (e) => {
        clearTimeout(timer);
        logger.error({ err: e.message }, 'AMI login failed');
      },
      timer,
    });
  }

  _id() {
    return `crm-${Date.now()}-${crypto.randomBytes(3).toString('hex')}`;
  }

  _raw(fields) {
    if (!this.sock) throw new Error('AMI not connected');
    const out = Object.entries(fields)
      .map(([k, v]) => `${k}: ${v}`)
      .join('\r\n');
    this.sock.write(out + '\r\n\r\n');
  }

  action(fields, { timeoutMs = 8000 } = {}) {
    return new Promise((resolve, reject) => {
      if (!this.loggedIn) return reject(new Error('AMI not ready'));
      const id = this._id();
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error(`AMI action ${fields.Action} timed out`));
      }, timeoutMs);
      this.pending.set(id, { resolve, reject, timer });
      try {
        this._raw({ ...fields, ActionID: id });
      } catch (e) {
        clearTimeout(timer);
        this.pending.delete(id);
        reject(e);
      }
    });
  }

  // ── high-level helpers ───────────────────────────────────────────────

  // Originate: ring the AGENT first (channel), then push into the outbound
  // context which dials the customer number (exten). This 2-leg pattern is
  // exactly what a real trunk + click-to-call needs.
  async originateToAgent({ agentChannel, exten, context, callerId, variables = {} }) {
    const varLines = Object.entries(variables)
      .map(([k, v]) => `${k}=${v}`)
      .join(',');
    return this.action(
      {
        Action: 'Originate',
        Channel: agentChannel,
        Context: context,
        Exten: exten,
        Priority: 1,
        CallerID: callerId || '',
        Async: 'true',
        Timeout: 30000,
        ...(varLines ? { Variable: varLines } : {}),
      },
      { timeoutMs: 12000 }
    );
  }

  async hangup(channel) {
    return this.action({ Action: 'Hangup', Channel: channel });
  }

  async redirect({ channel, context, exten, priority = 1 }) {
    return this.action({ Action: 'Redirect', Channel: channel, Context: context, Exten: exten, Priority: priority });
  }

  async setVar({ channel, variable, value }) {
    return this.action({ Action: 'Setvar', Channel: channel, Variable: variable, Value: value });
  }

  async coreShowVersion() {
    const r = await this.action({ Action: 'CoreSettings' }).catch(() => null);
    return r ? r.AsteriskVersion || r.CoreVersion : null;
  }

  async status() {
    return { connected: this.connected, loggedIn: this.loggedIn };
  }
}

const ami = new AmiClient();
module.exports = ami;
