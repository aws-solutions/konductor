function logger(level, message, fields = {}) {
  const entry = { at: new Date().toISOString(), level, message, ...fields };
  process.stdout.write(JSON.stringify(entry) + '\n');
}
module.exports = { logger };
