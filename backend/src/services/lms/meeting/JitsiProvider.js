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

  async getJoinUrl(session, { role = 'viewer', fullName = 'Guest', email = '' } = {}) {
    const room = encodeURIComponent(session.meetingId || session.roomName);
    const hash = new URLSearchParams();
    hash.set('userInfo.displayName', `"${fullName}"`);
    if (email) hash.set('userInfo.email', `"${email}"`);
    // force the UI to English regardless of the viewer's browser locale
    hash.set('config.defaultLanguage', '"en"');
    hash.set('interfaceConfig.LANG_DETECTION', 'false');
    // skip the "enter your name / pick devices" screen for everyone — name
    // and email are already known from the CRM login, so nobody re-types
    // anything each time they join.
    hash.set('config.prejoinPageEnabled', 'false');
    if (role !== 'moderator') {
      hash.set('config.startWithVideoMuted', 'true');
      hash.set('config.startWithAudioMuted', 'true');
      // Students: camera / mic / hangup only. Jitsi's whiteboard has no
      // view-only mode — anyone in the call can draw on one a teacher opens
      // — so it stays visible/enabled here (the ask was "visible, can't
      // edit"; hiding the *toolbar launcher* is the closest a student-side
      // config can get without also hiding it, since disabling the feature
      // outright removes it from view too).
      const toolbar = '["microphone","camera","hangup"]';
      hash.set('config.toolbarButtons', toolbar);
      hash.set('interfaceConfig.TOOLBAR_BUTTONS', toolbar);
    }
    // ?lang=en covers the pre-join ("join meeting") screen too
    return `${this.cfg.jitsiBase}/${room}?lang=en#${hash.toString()}`;
  }

  async endRoom() {
    return { ok: true }; // public Jitsi ends itself when everyone leaves
  }
}

module.exports = JitsiProvider;
