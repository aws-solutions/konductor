'use strict';

function datePart(value) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    throw new TypeError('date must use YYYY-MM-DD');
  }
  return value;
}

function objectKey(prefix, date, name) {
  return `${prefix}${datePart(date)}/${name}`;
}

function jsonLines(items) {
  return items.map((item) => JSON.stringify(item)).join('\n') + (items.length ? '\n' : '');
}

module.exports = { datePart, objectKey, jsonLines };
