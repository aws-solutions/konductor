const { normalizePhone } = require('./utils');
function usage() { return 'paper-lantern send --to NUMBER --body TEXT'; }
function parseArgs(args) {
  const result = {};
  for (let i = 0; i < args.length; i += 1) {
    if (args[i] === '--to') result.to = normalizePhone(args[++i]);
    if (args[i] === '--body') result.body = args[++i];
  }
  return result;
}
module.exports = { usage, parseArgs };
