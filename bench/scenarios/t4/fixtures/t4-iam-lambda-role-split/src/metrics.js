'use strict';
const totals = new Map();
function increment(name) { totals.set(name, (totals.get(name) || 0) + 1); }
function snapshot() { return Object.fromEntries(totals); }
module.exports = { increment, snapshot };
