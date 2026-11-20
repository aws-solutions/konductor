'use strict';

const { read } = require('../lib/conf');

module.exports = function buildJobReport() {
  const prefix = read("jobs.report.prefix", "report-");
  const name = prefix + 'daily';
  return { prefix, name };
};
