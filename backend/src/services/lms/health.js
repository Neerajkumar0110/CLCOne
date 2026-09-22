// In-process heartbeat registry for the LMS background tick jobs (spec §18
// "background worker monitoring"). Each tick job calls ping(name) on every
// run; the admin System Health panel reads snapshot() to show staleness.
// Deliberately in-memory only — on a serverless deployment (no persistent
// process) this will correctly show "never run in this process", which is
// itself useful signal that jobs aren't running there.
const heartbeats = {};

function ping(name) {
  heartbeats[name] = new Date();
}

function snapshot() {
  return { ...heartbeats };
}

module.exports = { ping, snapshot };
