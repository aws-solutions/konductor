'use strict';

function createLogger(sink = () => {}) {
  const write = (level, message, fields) => sink({ level, message, ...fields });
  return {
    info: (message, fields = {}) => write('info', message, fields),
    error: (message, fields = {}) => write('error', message, fields),
  };
}

module.exports = { createLogger };
