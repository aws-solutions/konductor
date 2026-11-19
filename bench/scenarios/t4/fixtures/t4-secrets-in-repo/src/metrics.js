const counts = new Map();

function increment(name) { counts.set(name, (counts.get(name) || 0) + 1); }
function snapshot() { return Object.fromEntries(counts); }
function reset() { counts.clear(); }

module.exports = { increment, snapshot, reset };
