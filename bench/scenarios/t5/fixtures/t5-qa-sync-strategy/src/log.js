function createLogger(writer = console) {
  return {
    info(message, details = {}) { writer.log(JSON.stringify({ level: 'info', message, ...details })); },
    warn(message, details = {}) { writer.warn(JSON.stringify({ level: 'warn', message, ...details })); },
    error(message, details = {}) { writer.error(JSON.stringify({ level: 'error', message, ...details })); }
  };
}

module.exports = { createLogger };
