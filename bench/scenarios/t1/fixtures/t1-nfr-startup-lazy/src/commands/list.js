'use strict';

const { COMMANDS } = require('../constants');
const output = require('../output');

function run() {
  output.line(`commands: ${COMMANDS.join(', ')}`);
  return 0;
}
module.exports = run;
