'use strict';

function isRecord(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function requiredString(value) {
  return typeof value === 'string' && value.trim().length > 0;
}

module.exports = { isRecord, requiredString };
