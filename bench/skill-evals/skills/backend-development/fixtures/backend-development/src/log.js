'use strict';

function log(level, message, fields = {}) {
  process.stdout.write(JSON.stringify({ level, message, ...fields }) + '\n');
}

module.exports = { log };
