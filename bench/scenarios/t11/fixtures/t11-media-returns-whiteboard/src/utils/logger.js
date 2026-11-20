'use strict';
function logger(level = 'info') {
  return { level, write(message, meta = {}) { return { level, message, meta }; } };
}
module.exports = { logger };
