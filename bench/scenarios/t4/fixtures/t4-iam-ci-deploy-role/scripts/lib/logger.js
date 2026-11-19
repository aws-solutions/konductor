'use strict';

function createLogger(write = console.log) {
  return {
    info(message, details = {}) { write(`[info] ${message} ${JSON.stringify(details)}`); },
    warn(message, details = {}) { write(`[warn] ${message} ${JSON.stringify(details)}`); }
  };
}

module.exports = { createLogger };
