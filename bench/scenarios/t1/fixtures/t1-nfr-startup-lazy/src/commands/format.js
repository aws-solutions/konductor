'use strict';

const { readInput } = require('../support/file-reader');
const { formatText } = require('../engines/format-engine');
require('../support/format-registration');
const output = require('../output');

function run(args, config) {
  const file = args[0] || `${config.root}/data/notes.txt`;
  try {
    const result = formatText(readInput(file));
    output.line(`format: ${result.lines} lines`);
    return 0;
  } catch (error) {
    output.error(`format: ${error.message}`);
    return 1;
  }
}
module.exports = run;
