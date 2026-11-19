'use strict';

const fs = require('node:fs');
const path = require('node:path');

const targets = ['README.md', 'CHANGELOG.md', 'docs/access-matrix.md'];
const missingFinalNewline = targets.filter((file) => {
  const text = fs.readFileSync(path.join(__dirname, '..', file), 'utf8');
  return !text.endsWith('\n');
});

if (missingFinalNewline.length) {
  console.error(`Missing final newline: ${missingFinalNewline.join(', ')}`);
  process.exitCode = 1;
} else {
  console.log(`Checked ${targets.length} text files`);
}
