'use strict';

const UNITS = ['B', 'KB', 'MB', 'GB', 'TB'];

// 1500 -> "1.5 KB". 1000-based, one decimal at most, TB is the largest unit.
function formatBytes(bytes) {
  if (typeof bytes !== 'number') throw new TypeError(`formatBytes: expected a number, got ${typeof bytes}`);
  if (!Number.isFinite(bytes)) throw new RangeError('formatBytes: input must be finite');
  if (bytes < 0) throw new RangeError('formatBytes: negative input');
  if (bytes < 1000) return `${Math.round(bytes)} B`;
  let value = bytes;
  let unit = 0;
  while (value >= 1000 && unit < UNITS.length - 1) {
    value /= 1000;
    unit += 1;
  }
  return `${Number(value.toFixed(1))} ${UNITS[unit]}`;
}

module.exports = { formatBytes };
