'use strict';

function encodeCursor(rowOffset) {
  return Buffer.from(String(rowOffset), 'utf8').toString('base64');
}

function decodeCursor(value) {
  if (!value) return 0;
  const offset = Number.parseInt(Buffer.from(value, 'base64').toString('utf8'), 10);
  return Number.isInteger(offset) && offset >= 0 ? offset : 0;
}

module.exports = { encodeCursor, decodeCursor };
