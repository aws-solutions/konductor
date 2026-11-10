'use strict';

const crypto = require('crypto');
const { cursorSecret } = require('../config');

function encodeCursor(offset) {
  const payload = Buffer.from(JSON.stringify({ offset })).toString('base64url');
  const sig = crypto.createHmac('sha256', cursorSecret).update(payload).digest('base64url');
  return `${payload}.${sig}`;
}

// Returns a non-negative integer offset, or null for a tampered or malformed cursor.
function decodeCursor(cursor) {
  if (typeof cursor !== 'string' || !cursor.includes('.')) return null;
  const [payload, sig] = cursor.split('.');
  const expected = crypto.createHmac('sha256', cursorSecret).update(payload).digest('base64url');
  if (sig.length !== expected.length || !crypto.timingSafeEqual(Buffer.from(sig), Buffer.from(expected))) return null;
  const { offset } = JSON.parse(Buffer.from(payload, 'base64url').toString());
  return Number.isInteger(offset) && offset >= 0 ? offset : null;
}

module.exports = { encodeCursor, decodeCursor };
