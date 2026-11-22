'use strict';

const fs = require('node:fs');
const path = require('node:path');

function walk(dir) {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = path.join(dir, entry.name);
    return entry.isDirectory() ? walk(full) : [full];
  });
}

const source = walk(path.resolve(__dirname, '..', 'src')).filter((file) => file.endsWith('.js'));
const bad = source.filter((file) => fs.readFileSync(file, 'utf8').includes('\t'));
if (bad.length) {
  console.error(`Tabs found in ${bad.join(', ')}`);
  process.exitCode = 1;
}
