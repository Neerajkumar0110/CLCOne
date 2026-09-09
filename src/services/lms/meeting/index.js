const { lmsConfig } = require('../../../config/lms');
const BigBlueButtonProvider = require('./BigBlueButtonProvider');
const JitsiProvider = require('./JitsiProvider');
const MockProvider = require('./MockProvider');

// One provider instance per process, chosen by config.meeting.effectiveProvider
// (which resolves `auto` -> bigbluebutton when BBB is configured, else jitsi,
// else mock). Swapping is config-only — the same liveClassService code path
// creates + joins real BBB rooms once BBB_URL / BBB_SECRET are set.

let _provider = null;
let _pickedFor = null;

function getMeetingProvider() {
  const pick = lmsConfig.meeting.effectiveProvider;
  if (_provider && _pickedFor === pick) return _provider;
  switch (pick) {
    case 'bigbluebutton':
      _provider = new BigBlueButtonProvider(lmsConfig.bbb);
      break;
    case 'jitsi':
      _provider = new JitsiProvider(lmsConfig.meeting);
      break;
    default:
      _provider = new MockProvider();
  }
  _pickedFor = pick;
  return _provider;
}

module.exports = { getMeetingProvider, BigBlueButtonProvider, JitsiProvider, MockProvider };
