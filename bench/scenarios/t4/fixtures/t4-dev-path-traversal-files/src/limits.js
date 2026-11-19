'use strict';

const DEFAULT_LIMIT = 8 * 1024 * 1024;

function withinLimit(size, limit = DEFAULT_LIMIT) {
  return Number.isInteger(size) && size >= 0 && size <= limit;
}

module.exports = { DEFAULT_LIMIT, withinLimit };
