'use strict';

function parseUtc(value) {
  const date = new Date(value);
  if (!value || Number.isNaN(date.getTime())) throw new RangeError('invalid timestamp');
  return date.toISOString();
}

function minuteKey(value) {
  return new Date(value).toISOString().slice(0, 16) + ':00.000Z';
}

module.exports = { parseUtc, minuteKey };
