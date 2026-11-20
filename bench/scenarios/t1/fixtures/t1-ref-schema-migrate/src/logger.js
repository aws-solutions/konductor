function logger(level = 'info') {
  const enabled = level !== 'silent';
  return {
    info(message, details = {}) {
      if (enabled) console.error(`[info] ${message}`, details);
    },
    warn(message, details = {}) {
      if (enabled) console.error(`[warn] ${message}`, details);
    }
  };
}
module.exports = { logger };
