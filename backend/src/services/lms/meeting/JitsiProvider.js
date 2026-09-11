const MeetingProvider = require('./MeetingProvider');
const { lmsConfig } = require('../../../config/lms');

// A hosted Jitsi Meet instance (default: the public meet.jit.si). No API / no
// auth on the public instance, so "rooms" are just unique names and the
// teacher/viewer split is cosmetic (config hints in the URL hash). Good
// enough as an interim provider; BigBlueButton is the real one.

class JitsiProvider extends MeetingProvider {
  constructor(cfg = lmsConfig.meeting) {
    super();
    this.cfg = cfg;
  }

  get name() {
    return 'jitsi';
  }
  get ready() {
    return !!this.cfg.jitsiBase;
  }

  async ensureRoom(session) {
    // room name = the already-computed roomName (Course-Batch-uniqueId)
    return { meetingId: session.roomName, roomName: session.roomName, providerData: { base: this.cfg.jitsiBase } };
  }

  async getJoinUrl(session, { role = 'viewer', fullName = 'Guest' } = {}) {
    const room = encodeURIComponent(session.meetingId || session.roomName);
    const hash = new URLSearchParams();
    hash.set('userInfo.displayName', `"${fullName}"`);
    // force the UI to English regardless of the viewer's browser locale
    hash.set('config.defaultLanguage', '"en"');
    hash.set('interfaceConfig.LANG_DETECTION', 'false');
    if (role !== 'moderator') {
      hash.set('config.startWithVideoMuted', 'true');
      hash.set('config.startWithAudioMuted', 'true');
    }
    // ?lang=en covers the pre-join ("join meeting") screen too
    return `${this.cfg.jitsiBase}/${room}?lang=en#${hash.toString()}`;
  }

  async endRoom() {
    return { ok: true }; // public Jitsi ends itself when everyone leaves
  }

  // For the in-app embed (frontend/src/pages/Lms/components/JitsiEmbed.jsx)
  // — structured fields for JitsiMeetExternalAPI instead of a single URL, so
  // the app can mount the meeting in an iframe with its own limited toolbar
  // (camera/mic/hangup/screen-share only) and skip the pre-join prompt,
  // rather than opening Jitsi's full default web client in a new tab.
  async getEmbedConfig(session, { role = 'viewer', fullName = 'Guest', email = '' } = {}) {
    const base = this.cfg.jitsiBase || 'https://meet.jit.si';
    const domain = base.replace(/^https?:\/\//, '').replace(/\/+$/, '');
    return {
      provider: 'jitsi',
      domain,
      roomName: session.meetingId || session.roomName,
      displayName: fullName,
      email: email || undefined,
      isModerator: role === 'moderator',
    };
  }
}

module.exports = JitsiProvider;
