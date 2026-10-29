'use strict';

const path = require('node:path');

// Resolves a name inside the storage directory and refuses anything that would leave it.
function inside(storageDir, relative) {
  const root = path.resolve(storageDir);
  const full = path.resolve(root, relative);
  if (full !== root && !full.startsWith(root + path.sep)) throw new Error(`path escapes the storage directory: ${relative}`);
  return full;
}

module.exports = { inside };
