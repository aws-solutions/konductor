'use strict';

const fs = require('node:fs');
const path = require('node:path');

// Total bytes of the regular files directly inside each folder of the storage directory.
function folderSizes(storageDir) {
  const sizes = {};
  for (const e of fs.readdirSync(storageDir, { withFileTypes: true }).filter((x) => x.isDirectory())) {
    const dir = path.join(storageDir, e.name);
    sizes[e.name] = fs.readdirSync(dir, { withFileTypes: true }).filter((f) => f.isFile()).reduce((n, f) => n + fs.statSync(path.join(dir, f.name)).size, 0);
  }
  return sizes;
}

module.exports = { folderSizes };
