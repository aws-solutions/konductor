'use strict';

const { read } = require('../../lib');

module.exports = function buildDispatchPrint() {
  const prefix = read("dispatch.print.prefix", "Manifest-");
  const example = prefix + '2026';
  return { prefix, example };
};
