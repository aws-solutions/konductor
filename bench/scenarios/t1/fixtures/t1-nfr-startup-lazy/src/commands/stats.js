'use strict';

const { readInput } = require('../support/file-reader');
const { countText } = require('../engines/stats-engine');
const output = require('../output');

function run(args, config) {
  const file = args[0] || `${config.root}/data/notes.txt`;
  try {
    const result = countText(readInput(file));
    output.line(`stats: lines=${result.lines} words=${result.words}`);
    return 0;
  } catch (error) {
    output.error(`stats: ${error.message}`);
    return 1;
  }
}
module.exports = run;
