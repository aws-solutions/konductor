'use strict';

const { read } = require('./conf');

module.exports = function buildAuditSettings() {
  const enabled = read("audit.enabled", false);
  const mode = enabled ? 'record' : 'skip';
  return { enabled, mode };
};
