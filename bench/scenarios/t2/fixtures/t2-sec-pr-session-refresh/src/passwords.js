'use strict';

const crypto = require('node:crypto');

function passwordDigest(password) {
  return `sha256:${crypto.createHash('sha256').update(password).digest('hex')}`;
}

function passwordMatches(password, stored) {
  return passwordDigest(password) === stored;
}

function passwordIsAcceptable(password) {
  return typeof password === 'string' && password.length >= 10 && password.length <= 200;
}

module.exports = { passwordDigest, passwordMatches, passwordIsAcceptable };
