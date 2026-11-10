'use strict';

const CURSOR_KEYS = ['accountId', 'createdAt'];

function decodeCursor(token) {
  if (token === undefined) return undefined;
  let parsed;
  try {
    parsed = JSON.parse(Buffer.from(String(token), 'base64url').toString('utf8'));
  } catch (e) {
    const err = new Error('Invalid cursor');
    err.name = 'ValidationError';
    throw err;
  }
  const keys = Object.keys(parsed).sort();
  if (keys.join(',') !== [...CURSOR_KEYS].sort().join(',')) {
    const err = new Error('Invalid cursor');
    err.name = 'ValidationError';
    throw err;
  }
  return parsed;
}

function encodeCursor(key) {
  return key ? Buffer.from(JSON.stringify(key)).toString('base64url') : undefined;
}

module.exports = { decodeCursor, encodeCursor };
