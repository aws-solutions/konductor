'use strict';

const fs = require('node:fs');
const path = require('node:path');

const source = path.join(__dirname, '..', 'src');
const files = fs.readdirSync(source).filter((name) => name.endsWith('.js'));
for (const file of files) {
  const text = fs.readFileSync(path.join(source, file), 'utf8');
  if (!text.endsWith('\n')) throw new Error(`${file} has no final newline`);
}
process.stdout.write(`checked ${files.length} source files\n`);
