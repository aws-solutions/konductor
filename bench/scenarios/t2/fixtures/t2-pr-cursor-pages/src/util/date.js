'use strict';

function isoNow(clock = Date) {
  return new clock().toISOString();
}

function compareIso(left, right) {
  return String(left).localeCompare(String(right));
}

module.exports = { isoNow, compareIso };
