'use strict';

// Keep command modules out of the initial CLI path. The loader is deliberately
// tiny so a command still gets its normal CommonJS module identity on demand.
function lazyCommand(load) {
  let command;
  return (...args) => {
    if (!command) command = load();
    return command(...args);
  };
}

module.exports = lazyCommand;
