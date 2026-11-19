'use strict';

const { readInput } = require('../support/file-reader');
const { checkText } = require('../engines/check-engine');
const output = require('../output');

function run(args, config) {
  const file = args[0] || `${config.root}/data/sample.json`;
  try {
    const text = readInput(file);
    const result = checkText(text);
    output.line(`check: ${result.ok ? 'clean' : `${result.issues} issue(s)`}`);
    return result.ok ? 0 : 1;
  } catch (error) {
    output.error(`check: ${error.message}`);
    return 1;
  }
}
module.exports = run;
