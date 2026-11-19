'use strict';

const typeOf = require('../support/value-type');

function describeValue(value) {
  return typeOf(value);
}
module.exports = { describeValue };
