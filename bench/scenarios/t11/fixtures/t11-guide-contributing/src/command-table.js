'use strict';
const commands = require('./generated/command-index');
function hasCommand(name) { return commands.some((command) => command.name === name); }
module.exports = { commands, hasCommand };
