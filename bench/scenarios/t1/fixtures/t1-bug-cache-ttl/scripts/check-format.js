'use strict';

const fs = require('node:fs');
const path = require('node:path');

function walk(dir) {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = path.join(dir, entry.name);
    return entry.isDirectory() ? walk(full) : [full];
  });
}

const files = walk(path.join(__dirname, '..', 'src')).filter((file) => file.endsWith('.js'));
const bad = files.filter((file) => !fs.readFileSync(file, 'utf8').endsWith('\n'));
if (bad.length) {
  console.error(`Missing final newline: ${bad.join(', ')}`);
  process.exitCode = 1;
}
