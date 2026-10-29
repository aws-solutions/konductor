'use strict';

// Legacy key handling: surrounding whitespace is ignored. An empty key is valid.
function normalizeKey(key) {
  if (typeof key !== 'string') throw new TypeError('key must be a string');
  return key.trim();
}

module.exports = { normalizeKey };
