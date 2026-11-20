// Changes for this request; see the commit message for the reasoning.
'use strict';

const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');

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

function hashFile(filePath) {
  const content = fs.readFileSync(filePath);
  return crypto.createHash('sha256').update(content).digest('hex');
}

module.exports = { buildManifest, hashFile };