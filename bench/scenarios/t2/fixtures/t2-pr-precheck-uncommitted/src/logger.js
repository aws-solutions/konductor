'use strict';

function createLogger(write = console) {
  return {
    info(message, details) {
      write.log(JSON.stringify({ level: 'info', message, details, at: new Date().toISOString() }));
    },
    warn(message, details) {
      write.warn(JSON.stringify({ level: 'warn', message, details, at: new Date().toISOString() }));
    },
    error(message, details) {
      write.error(JSON.stringify({ level: 'error', message, details, at: new Date().toISOString() }));
    }
  };
}

module.exports = { createLogger };
