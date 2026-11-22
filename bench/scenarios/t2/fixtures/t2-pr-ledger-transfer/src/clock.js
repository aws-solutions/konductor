'use strict';

function nowIso() { return new Date().toISOString(); }
function utcDateKey(date = new Date()) { return date.toISOString().slice(0, 10); }

module.exports = { nowIso, utcDateKey };
