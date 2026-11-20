'use strict';
function isoNow(clock = () => new Date()) { return clock().toISOString(); }
function isDateString(value) { return typeof value === 'string' && !Number.isNaN(Date.parse(value)); }
module.exports = { isoNow, isDateString };
