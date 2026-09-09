// Base contract for a live-class meeting provider. Implementations:
//   BigBlueButtonProvider  — real rooms on a dedicated BBB host
//   JitsiProvider          — a public/hosted Jitsi Meet instance
//   MockProvider           — the CRM's own room page (no external service)
//
// A `session` here is an LmsLiveSession mongoose doc. Providers never touch
// Mongo — they build URLs / call the meeting server and return plain data.
// liveClassService.js persists the result.

class MeetingProvider {
  get name() {
    return 'base';
  }

  // True if the provider can actually create/join real meetings right now.
  get ready() {
    return false;
  }

  // Ensure the meeting room exists on the provider. Returns
  //   { meetingId, roomName, moderatorPW, attendeePW, providerData }
  // Safe to call more than once.
  async ensureRoom(/* session, ctx */) {
    throw new Error('ensureRoom not implemented');
  }

  // Build the URL a browser opens to enter the room, for one person.
  //   opts: { role: 'moderator'|'viewer', fullName, userId }
  // Returns a string URL. This URL is what the ticket redirect sends the
  // user to — it is never returned in a normal API JSON body.
  async getJoinUrl(/* session, opts */) {
    throw new Error('getJoinUrl not implemented');
  }

  // End the meeting on the provider (best-effort).
  async endRoom(/* session */) {
    return { ok: true };
  }

  // Is the meeting currently running on the provider?
  async isRunning(/* session */) {
    return null; // unknown
  }

  // Live participant list for attendance reconciliation, or null.
  async getParticipants(/* session */) {
    return null;
  }
}

module.exports = MeetingProvider;
