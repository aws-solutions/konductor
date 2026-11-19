'use strict';

function quiet() { return undefined; }
function createLogger(writer) {
  const write = typeof writer === 'function' ? writer : quiet;
  return { info: (message) => write('info', message), warn: (message) => write('warn', message) };
}

module.exports = { createLogger };
