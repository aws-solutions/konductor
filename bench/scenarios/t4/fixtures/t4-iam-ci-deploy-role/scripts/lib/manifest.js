'use strict';

const fs = require('node:fs');
const path = require('node:path');

function walk(dir, root = dir, output = []) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) walk(full, root, output);
    else output.push({ key: path.relative(root, full).split(path.sep).join('/'), file: full });
  }
  return output.sort((a, b) => a.key.localeCompare(b.key));
}

function buildManifest(root) {
  return walk(root);
}

module.exports = { buildManifest };
