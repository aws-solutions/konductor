'use strict';

const fs = require('node:fs');
const path = require('node:path');

for (const directory of ['src', 'tests']) {
  for (const name of fs.readdirSync(path.join(process.cwd(), directory))) {
    if (name.endsWith('.js')) {
      const file = path.join(directory, name);
      if (!fs.readFileSync(file, 'utf8').endsWith('\n')) throw new Error(`${file} needs a final newline`);
    }
  }
}
console.log('format checks passed');
