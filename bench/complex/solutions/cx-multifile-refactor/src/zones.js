'use strict';

const { normalizeZip } = require('./util');

function lookupZone(zip) {
  const first = normalizeZip(zip).charAt(0);
  if (first >= '0' && first <= '3') return 1;
  if (first >= '4' && first <= '6') return 2;
  if (first >= '7' && first <= '9') return 3;
  return 4;
}

module.exports = { lookupZone };
