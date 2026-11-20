'use strict';

function minutesBetween(start, end) {
  const a = new Date(start);
  const b = new Date(end);
  return Math.round((b - a) / 60000);
}

function sameDay(first, second) {
  return new Date(first).toDateString() === new Date(second).toDateString();
}

module.exports = { minutesBetween, sameDay };
