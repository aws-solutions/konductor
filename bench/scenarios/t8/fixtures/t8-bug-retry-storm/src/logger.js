'use strict';

function createLogger(write = process.stdout.write.bind(process.stdout)) {
  return {
    info(message, fields = {}) { write(JSON.stringify({ level: 'info', message, ...fields }) + '\n'); },
    warn(message, fields = {}) { write(JSON.stringify({ level: 'warn', message, ...fields }) + '\n'); },
    error(message, fields = {}) { write(JSON.stringify({ level: 'error', message, ...fields }) + '\n'); }
  };
}

module.exports = { createLogger };
