function write(level, message, fields) {
  const record = { level, message, ...(fields || {}) };
  process.stdout.write(JSON.stringify(record) + '\n');
}

module.exports = {
  debug: (message, fields) => write('debug', message, fields),
  info: (message, fields) => write('info', message, fields),
  warn: (message, fields) => write('warn', message, fields),
  error: (message, fields) => write('error', message, fields)
};
