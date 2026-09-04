const { callingConfig } = require('../../config/calling');
const MockCallingProvider = require('./MockCallingProvider');
const VicidialProvider = require('./VicidialProvider');
const TelephonyProvider = require('./TelephonyProvider');
const CloudCallProvider = require('./CloudCallProvider');

// Factory — one provider instance per process, chosen by CALLING_PROVIDER.
// Swapping providers is config-only; no controller code changes.
//   mock       → simulation (default)
//   telephony  → VPS Telephony Integration Service (VICIdial + Asterisk)
//   vicidial   → legacy direct stub (kept for reference)
let _provider = null;

function getProvider() {
  if (_provider) return _provider;
  switch (callingConfig.provider) {
    case 'cloud':
      _provider = new CloudCallProvider(callingConfig);
      break;
    case 'telephony':
      _provider = new TelephonyProvider(callingConfig);
      break;
    case 'vicidial':
      _provider = new VicidialProvider(callingConfig);
      break;
    default:
      _provider = new MockCallingProvider(callingConfig);
  }
  return _provider;
}

module.exports = { getProvider, callingConfig };
