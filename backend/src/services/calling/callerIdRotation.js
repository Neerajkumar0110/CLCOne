const { callingConfig } = require('../../config/calling');

// Outbound caller-ID rotation (user request 2026-11-12): every customer call
// goes out from the next of our Plivo numbers in turn — call 1 from number 1,
// call 2 from number 2, … then back to the first. The numbers are
// CLOUD_CALL_CALLER_IDS (comma-separated, digits with country code); with
// one or none listed, every call uses CLOUD_CALL_CALLER_ID as before.
//
// Only for legs that ring a CUSTOMER — legs that ring our own users keep the
// default number. One backend process runs the dialer, so an in-memory
// counter is enough (a restart just starts again from the first number).
let turn = 0;

function callerIdPool() {
  const list = callingConfig.cloud.callerIds.filter(Boolean);
  return list.length ? list : [callingConfig.cloud.callerId].filter(Boolean);
}

function nextCallerId() {
  const list = callerIdPool();
  if (!list.length) return callingConfig.cloud.callerId || undefined;
  const id = list[turn % list.length];
  turn = (turn + 1) % 1e9;
  return id;
}

module.exports = { nextCallerId, callerIdPool };
