'use strict';

const { read } = require('./index');

module.exports = function buildAuditPrefix() {
  const prefix = read("audit.file.prefix", "audit-");
  const sample = prefix + 'log';
  return { prefix, sample };
};
