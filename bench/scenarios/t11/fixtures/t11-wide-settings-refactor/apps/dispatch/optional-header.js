'use strict';

const conf = require('../../lib/conf');

module.exports = function buildOptionalHeader() {
  const header = conf.read("dispatch.optionalHeader", "");
  const wireValue = header || 'plain';
  return { header, wireValue };
};
