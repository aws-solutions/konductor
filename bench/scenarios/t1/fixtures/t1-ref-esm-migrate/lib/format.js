'use strict';
const { DEFAULT_PREFIX } = require('./constants');
const { normalize } = require('./normalize');

function format(value, options = {}) {
  const text = normalize(value);
  const prefix = options.prefix ?? DEFAULT_PREFIX;
  return `${prefix} ${options.upper ? text.toUpperCase() : text}`;
}

module.exports = { format };
