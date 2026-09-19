// Deterministic thread key for a 1:1 conversation — sorted so it's the same
// regardless of who's "from" and who's "to".
function conversationIdFor(a, b) {
  return [String(a), String(b)].sort().join('_');
}

module.exports = conversationIdFor;
