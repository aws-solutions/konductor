function createLogger(level = 'info', output = console) {
  const rank = { debug: 10, info: 20, warn: 30, error: 40 };
  const threshold = rank[level] || rank.info;
  return {
    debug(message, fields) { if (threshold <= 10) output.log(format(message, fields)); },
    info(message, fields) { if (threshold <= 20) output.log(format(message, fields)); },
    warn(message, fields) { if (threshold <= 30) output.warn(format(message, fields)); },
    error(message, fields) { output.error(format(message, fields)); }
  };
}

function format(message, fields) {
  return fields ? `${message} ${JSON.stringify(fields)}` : message;
}

module.exports = { createLogger };
