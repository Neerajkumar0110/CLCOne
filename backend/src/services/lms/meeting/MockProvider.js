const MeetingProvider = require('./MeetingProvider');
const { lmsConfig } = require('../../../config/lms');

// No external meeting service. "Joining" opens the CRM's own stand-in room
// page (lmsController/liveclass.js mockRoom, via /api/lms/live/mock/:id),
// which shows the role-appropriate control list + a Leave button. Used until a
// real provider (BigBlueButton) is configured. Marked isMock on the session.

class MockProvider extends MeetingProvider {
  get name() {
    return 'mock';
  }
  get ready() {
    return true;
  }

  async ensureRoom(session) {
    return { meetingId: session.roomName, roomName: session.roomName, providerData: { mock: true } };
  }

  async getJoinUrl(session, { role = 'viewer', userId } = {}) {
    const base = lmsConfig.meeting.crmBaseUrl || '';
    const r = role === 'moderator' ? 'teacher' : 'student';
    const u = userId ? `&u=${encodeURIComponent(userId)}` : '';
    return `${base}/api/lms/live/mock/${session._id}?k=${session.publicKey || ''}&role=${r}${u}`;
  }

  async endRoom() {
    return { ok: true };
  }
}

module.exports = MockProvider;
