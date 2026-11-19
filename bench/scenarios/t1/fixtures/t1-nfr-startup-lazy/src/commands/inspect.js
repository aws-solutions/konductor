'use strict';

const { readJson } = require('../support/json-store');
const { describeValue } = require('../engines/inspect-engine');
const output = require('../output');

function run(args, config) {
  const file = args[0] || `${config.root}/data/sample.json`;
  try {
    output.line(`inspect: ${describeValue(readJson(file))}`);
    return 0;
  } catch (error) {
    output.error(`inspect: ${error.message}`);
    return 1;
  }
}
module.exports = run;
