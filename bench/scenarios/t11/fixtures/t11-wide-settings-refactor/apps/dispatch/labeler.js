'use strict';

const { read } = require('../../lib/conf');

module.exports = function buildDispatchLabeler() {
  const prefix = read("dispatch.labels.prefix", "D-");
  const sample = prefix + '001';
  return { prefix, sample };
};
