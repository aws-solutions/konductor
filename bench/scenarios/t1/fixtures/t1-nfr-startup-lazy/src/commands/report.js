'use strict';

const { readInput } = require('../support/file-reader');
const { makeReport } = require('../engines/report-engine');
const { REPORT_HEADER } = require('../constants');
const output = require('../output');

function run(args, config, options = {}) {
  const file = args[0] || `${config.root}/data/sample.json`;
  try {
    const header = options.reportHeader || REPORT_HEADER;
    output.line(makeReport(header, file, readInput(file)));
    return 0;
  } catch (error) {
    output.error(`report: ${error.message}`);
    return 1;
  }
}
module.exports = run;
