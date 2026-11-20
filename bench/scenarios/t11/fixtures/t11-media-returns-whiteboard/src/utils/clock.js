'use strict';
function systemClock() { return new Date(); }
function iso(clock = systemClock) { return clock().toISOString(); }
module.exports = { systemClock, iso };
