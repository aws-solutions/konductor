'use strict';

const assert = require('node:assert/strict');

function assertQuote(quote, expected) {
  assert.deepEqual(quote, expected);
}

module.exports = { assertQuote };
