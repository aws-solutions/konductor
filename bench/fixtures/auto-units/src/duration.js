'use strict';

const { assertFinite } = require('./guard');

// 3723000 -> "1h 2m 3s"; zero units at the front are dropped; under a second is "0s".
function formatDuration(ms) {
  assertFinite('formatDuration', ms);
  if (ms < 0) throw new RangeError('formatDuration: negative input');
  const total = Math.floor(ms / 1000);
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  const parts = [];
  if (h) parts.push(`${h}h`);
  if (h || m) parts.push(`${m}m`);
  parts.push(`${s}s`);
  return parts.join(' ');
}

module.exports = { formatDuration };
