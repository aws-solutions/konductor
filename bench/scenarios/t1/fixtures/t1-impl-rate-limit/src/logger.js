function createLogger(level = 'info', output = process.stdout) {
  const silent = level === 'silent';
  return {
    info(event, fields = {}) {
      if (!silent) output.write(JSON.stringify({ level: 'info', event, ...fields }) + '\n');
    },
    error(event, fields = {}) {
      if (!silent) output.write(JSON.stringify({ level: 'error', event, ...fields }) + '\n');
    }
  };
}

module.exports = { createLogger };
