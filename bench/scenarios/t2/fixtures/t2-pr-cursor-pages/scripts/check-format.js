'use strict';

const fs = require('node:fs');
const path = require('node:path');

function walk(directory) {
  return fs.readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const full = path.join(directory, entry.name);
    return entry.isDirectory() ? walk(full) : [full];
  });
}

const files = walk(path.join(__dirname, '..', 'src')).filter((file) => file.endsWith('.js'));
for (const file of files) {
  if (!fs.readFileSync(file, 'utf8').endsWith('\n')) throw new Error(`${file} has no final newline`);
}
console.log(`checked ${files.length} source files`);
