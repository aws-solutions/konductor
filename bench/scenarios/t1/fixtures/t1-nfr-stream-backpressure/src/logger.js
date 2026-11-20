function logger(level = 'info') {
  return {
    info(message) { if (level !== 'silent') process.stdout.write(`[info] ${message}\n`); },
    error(message) { process.stderr.write(`[error] ${message}\n`); }
  };
}
module.exports = logger;
