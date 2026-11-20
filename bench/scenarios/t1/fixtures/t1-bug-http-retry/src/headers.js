'use strict';

function normaliseHeaders(headers = {}) {
  const result = {};
  for (const [key, value] of Object.entries(headers)) {
    result[String(key).toLowerCase()] = Array.isArray(value) ? value.join(', ') : String(value);
  }
  return result;
}

function hasHeader(headers, name) {
  return Object.prototype.hasOwnProperty.call(normaliseHeaders(headers), name.toLowerCase());
}

module.exports = { normaliseHeaders, hasHeader };
