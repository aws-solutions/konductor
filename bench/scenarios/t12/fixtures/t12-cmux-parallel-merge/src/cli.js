'use strict';

const commands = require('./commands/index.js');

/** Runs one command line (`argv` without the program name) against `store` and returns what it prints. */
function run(argv, store) {
  const [name, ...args] = argv;
  if (!name || name === 'help') return `commands: ${Object.keys(commands).sort().join(', ')}`;
  if (!Object.hasOwn(commands, name)) throw new Error(`unknown command: ${name}`);
  return commands[name](args, store);
}

module.exports = { run };
