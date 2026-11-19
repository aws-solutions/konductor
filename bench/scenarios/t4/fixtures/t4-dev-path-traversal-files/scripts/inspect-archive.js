'use strict';

const fs = require('node:fs');
const { readArchive } = require('../src/archive');
const file = process.argv[2];
if (!file) throw new Error('archive path required');
for (const entry of readArchive(fs.readFileSync(file))) {
  process.stdout.write(`${entry.name}\t${entry.content.length}\n`);
}
