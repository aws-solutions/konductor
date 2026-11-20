'use strict';

function createLogger(verbose = false, output = console) {
  return {
    info(message) { if (verbose) output.error(`[info] ${message}`); },
    warn(message) { output.error(`[warn] ${message}`); }
  };
}

module.exports = { createLogger };
