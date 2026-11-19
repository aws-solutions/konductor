function createLogger(level = 'info', output = console) {
  const order = { silent: 0, error: 1, info: 2, debug: 3 };
  const enabled = name => order[level] >= order[name];
  const write = (name, message, fields = {}) => {
    if (!enabled(name)) return;
    const entry = { level: name, message, ...fields, time: new Date().toISOString() };
    const line = JSON.stringify(entry);
    if (name === 'error') output.error(line);
    else output.log(line);
  };
  return {
    info(message, fields) { write('info', message, fields); },
    error(message, fields) { write('error', message, fields); },
    debug(message, fields) { write('debug', message, fields); }
  };
}

module.exports = { createLogger };
