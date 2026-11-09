'use strict';

const { randomBytes } = require('node:crypto');

function newCorrelationId() {
  return randomBytes(4).toString('hex');
}

module.exports = { newCorrelationId };
