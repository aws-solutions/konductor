'use strict';

function createLogger(level = 'info') {
  const rank = { silent: 0, error: 1, info: 2, debug: 3 };
  function write(kind, message, details) {
    if ((rank[kind] || 0) <= (rank[level] || 2)) {
      process.stderr.write(`[${kind}] ${message}${details ? ` ${JSON.stringify(details)}` : ''}\n`);
    }
  }
  return {
    error: (message, details) => write('error', message, details),
    info: (message, details) => write('info', message, details),
    debug: (message, details) => write('debug', message, details)
  };
}

module.exports = { createLogger };
