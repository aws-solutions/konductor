'use strict';

const fs = require('node:fs');
const path = require('node:path');

function readEntries(filePath) {
  const resolved = path.resolve(filePath);
  return JSON.parse(fs.readFileSync(resolved, 'utf8'));
}

function writeEntries(filePath, entries) {
  const resolved = path.resolve(filePath);
  fs.mkdirSync(path.dirname(resolved), { recursive: true });
  fs.writeFileSync(resolved, JSON.stringify(entries, null, 2) + '\n');
}

module.exports = { readEntries, writeEntries };
