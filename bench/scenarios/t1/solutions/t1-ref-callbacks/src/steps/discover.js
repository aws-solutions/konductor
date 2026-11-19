'use strict';

const fs = require('node:fs/promises');
const path = require('node:path');

async function discoverFiles(inputDir) {
  const entries = await fs.readdir(inputDir, { withFileTypes: true });
  return entries
    .filter((entry) => entry.isFile() && entry.name.endsWith('.txt'))
    .map((entry) => entry.name)
    .sort((a, b) => a.localeCompare(b))
    .map((name) => path.join(inputDir, name));
}

module.exports = { discoverFiles };
