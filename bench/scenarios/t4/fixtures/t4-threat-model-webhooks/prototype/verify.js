'use strict';

const crypto = require('node:crypto');

function sign(secret, body) {
  return crypto.createHmac('sha256', secret).update(body).digest('hex');
}

function verifySignature(secret, body, supplied) {
  return sign(secret, body) === supplied;
}

module.exports = { sign, verifySignature };
