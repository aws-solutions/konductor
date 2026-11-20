'use strict';

function pad(value, width) {
  return String(value).padStart(width, '0');
}

function compactDate(date) {
  return `${date.getUTCFullYear()}-${pad(date.getUTCMonth() + 1, 2)}-${pad(date.getUTCDate(), 2)}`;
}

module.exports = { compactDate };
