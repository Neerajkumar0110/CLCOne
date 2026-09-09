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
    if (role !== 'moderator') {
      hash.set('config.startWithVideoMuted', 'true');
      hash.set('config.startWithAudioMuted', 'true');
    }
    return `${this.cfg.jitsiBase}/${room}#${hash.toString()}`;
  }

  async endRoom() {
    return { ok: true }; // public Jitsi ends itself when everyone leaves
  }
}

module.exports = JitsiProvider;
