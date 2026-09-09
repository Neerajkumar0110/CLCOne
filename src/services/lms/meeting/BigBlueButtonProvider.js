const crypto = require('crypto');
const MeetingProvider = require('./MeetingProvider');
const { lmsConfig } = require('../../../config/lms');

// Real BigBlueButton rooms. Uses the BBB API directly:
//   GET <bbb.url>/api/<call>?<params>&checksum=<HASH(call + params + secret)>
// Responses are XML; BBB's are flat enough for a tiny regex parser.
//
// role -> BBB: moderator => role=MODERATOR (+ moderatorPW), viewer => VIEWER.

function xmlVal(xml, tag) {
  const m = new RegExp(`<${tag}>([\\s\\S]*?)</${tag}>`).exec(xml || '');
  return m ? m[1].trim() : undefined;
}
function xmlAll(xml, tag) {
  const out = [];
  const re = new RegExp(`<${tag}>([\\s\\S]*?)</${tag}>`, 'g');
  let m;
  while ((m = re.exec(xml || ''))) out.push(m[1]);
  return out;
}

class BigBlueButtonProvider extends MeetingProvider {
  constructor(cfg = lmsConfig.bbb) {
    super();
    this.cfg = cfg;
  }

  get name() {
    return 'bigbluebutton';
  }
  get ready() {
    return !!(this.cfg.url && this.cfg.secret);
  }

  _checksum(call, query) {
    const algo = this.cfg.checksumAlgo === 'sha256' ? 'sha256' : 'sha1';
    return crypto.createHash(algo).update(call + query + this.cfg.secret).digest('hex');
  }

  // Build a signed API URL. `params` is a plain object.
  _url(call, params) {
    const query = new URLSearchParams(params).toString();
    const checksum = this._checksum(call, query);
    return `${this.cfg.url}/api/${call}?${query}&checksum=${checksum}`;
  }

  async _call(call, params) {
    if (!this.ready) throw new Error('BigBlueButton is not configured (BBB_URL / BBB_SECRET).');
    const url = this._url(call, params);
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), this.cfg.timeoutMs || 10000);
    try {
      const res = await fetch(url, { signal: ctrl.signal });
      const text = await res.text();
      const returncode = xmlVal(text, 'returncode');
      if (returncode && returncode !== 'SUCCESS') {
        const err = new Error(`BBB ${call} failed: ${xmlVal(text, 'messageKey')} — ${xmlVal(text, 'message')}`);
        err.bbb = { messageKey: xmlVal(text, 'messageKey'), message: xmlVal(text, 'message') };
        throw err;
      }
      return { text, xmlVal: (t) => xmlVal(text, t), xmlAll: (t) => xmlAll(text, t) };
    } finally {
      clearTimeout(timer);
    }
  }

  async ensureRoom(session, ctx = {}) {
    const meetingId = session.meetingId || `clc-${session._id}`;
    const modPW = session.moderatorPW || crypto.randomBytes(9).toString('hex');
    const attPW = session.attendeePW || crypto.randomBytes(9).toString('hex');
    const base = lmsConfig.meeting.crmBaseUrl || '';
    const record = ctx.record !== undefined ? !!ctx.record : this.cfg.record;

    const params = {
      name: session.roomName || session.title || `Class ${meetingId}`,
      meetingID: meetingId,
      moderatorPW: modPW,
      attendeePW: attPW,
      record: record ? 'true' : 'false',
      // recording follows the configured policy — no manual start needed
      autoStartRecording: record ? 'true' : 'false',
      allowStartStopRecording: 'true',
      welcome: `Welcome to ${session.title || 'the class'}.`,
      meta_source: 'clc-crm',
      meta_courseName: session.courseTitle || '',
      meta_batchName: session.batchName || '',
      meta_crmSessionId: String(session._id),
    };
    if (base) params.logoutURL = `${base}/api/lms/live/left?s=${session._id}`;
    if (session.scheduledEnd) {
      const mins = Math.max(15, Math.round((new Date(session.scheduledEnd) - Date.now()) / 60000) + 30);
      params.duration = String(mins);
    }

    const r = await this._call('create', params);
    return {
      meetingId,
      roomName: params.name,
      moderatorPW: modPW,
      attendeePW: attPW,
      providerData: {
        internalMeetingID: r.xmlVal('internalMeetingID'),
        createTime: r.xmlVal('createTime'),
        voiceBridge: r.xmlVal('voiceBridge'),
      },
    };
  }

  async getJoinUrl(session, { role = 'viewer', fullName = 'Guest', userId } = {}) {
    const meetingId = session.meetingId || `clc-${session._id}`;
    const params = {
      fullName,
      meetingID: meetingId,
      role: role === 'moderator' ? 'MODERATOR' : 'VIEWER',
      redirect: 'true',
    };
    // Older BBB wants the password rather than role=; send both for safety.
    params.password = role === 'moderator' ? session.moderatorPW : session.attendeePW;
    if (userId) params.userID = String(userId);
    const query = new URLSearchParams(params).toString();
    const checksum = this._checksum('join', query);
    return `${this.cfg.url}/api/join?${query}&checksum=${checksum}`;
  }

  async endRoom(session) {
    if (!session.meetingId) return { ok: true };
    try {
      await this._call('end', { meetingID: session.meetingId, password: session.moderatorPW });
      return { ok: true };
    } catch (e) {
      return { ok: false, error: e.message };
    }
  }

  async isRunning(session) {
    if (!session.meetingId) return null;
    try {
      const r = await this._call('isMeetingRunning', { meetingID: session.meetingId });
      return r.xmlVal('running') === 'true';
    } catch (e) {
      return null;
    }
  }

  async getParticipants(session) {
    if (!session.meetingId) return null;
    try {
      const r = await this._call('getMeetingInfo', {
        meetingID: session.meetingId,
        password: session.moderatorPW,
      });
      return r.xmlAll('attendee').map((a) => ({
        userId: xmlVal(a, 'userID'),
        name: xmlVal(a, 'fullName'),
        role: xmlVal(a, 'role'),
      }));
    } catch (e) {
      return null;
    }
  }

  // getRecordings — poll for a session's recording after it ends.
  async getRecordings(session) {
    const meetingId = session.meetingId;
    if (!meetingId) return [];
    const r = await this._call('getRecordings', { meetingID: meetingId });
    return r.xmlAll('recording').map((rec) => {
      const playbackBlock = /<playback>([\s\S]*?)<\/playback>/.exec(rec);
      const fmt = playbackBlock ? playbackBlock[1] : '';
      return {
        recordID: xmlVal(rec, 'recordID'),
        state: xmlVal(rec, 'state'), // processing | processed | published | unpublished | deleted
        published: xmlVal(rec, 'published') === 'true',
        startTime: Number(xmlVal(rec, 'startTime')) || undefined,
        endTime: Number(xmlVal(rec, 'endTime')) || undefined,
        durationMin:
          Number(xmlVal(rec, 'endTime')) && Number(xmlVal(rec, 'startTime'))
            ? Math.round((Number(xmlVal(rec, 'endTime')) - Number(xmlVal(rec, 'startTime'))) / 60000)
            : undefined,
        playbackUrl: xmlVal(fmt, 'url'),
        type: xmlVal(fmt, 'type'),
      };
    });
  }

  // Verify an incoming BBB webhook payload's checksum (if configured to send one).
  verifyWebhook(rawBody, providedChecksum) {
    if (!providedChecksum) return true; // some setups rely on network trust only
    const algo = this.cfg.checksumAlgo === 'sha256' ? 'sha256' : 'sha1';
    const expected = crypto.createHash(algo).update(String(rawBody || '') + this.cfg.secret).digest('hex');
    try {
      return crypto.timingSafeEqual(Buffer.from(expected), Buffer.from(String(providedChecksum)));
    } catch (e) {
      return false;
    }
  }
}

module.exports = BigBlueButtonProvider;
