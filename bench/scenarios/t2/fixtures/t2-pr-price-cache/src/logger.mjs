export function createLogger(output = console) {
  return {
    info(message, fields = {}) { output.log(JSON.stringify({ level: 'info', message, ...fields })); },
    warn(message, fields = {}) { output.warn(JSON.stringify({ level: 'warn', message, ...fields })); },
    error(message, fields = {}) { output.error(JSON.stringify({ level: 'error', message, ...fields })); }
  };
}
