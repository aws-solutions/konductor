function info(message) {
  process.stderr.write(`[info] ${message}\n`);
}

function error(message) {
  process.stderr.write(`[error] ${message}\n`);
}

module.exports = { info, error };
