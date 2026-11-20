'use strict';

const { InvalidUserIdError } = require('./errors');

function assertUserId(userId) {
  if (typeof userId !== 'string' || userId.trim() === '') throw new InvalidUserIdError();
  return userId;
}

function assertPayload(payload, maxBytes = 65536) {
  const bytes = Buffer.byteLength(JSON.stringify(payload));
  if (bytes > maxBytes) throw new RangeError('notification payload is too large');
  return payload;
}

module.exports = { assertUserId, assertPayload };
