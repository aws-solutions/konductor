const fs = require('node:fs');
const path = require('node:path');
const roots = ['src', 'migrations'];
for (const root of roots) {
  for (const file of fs.readdirSync(path.join(__dirname, '..', root))) {
    if (file.endsWith('.js')) fs.accessSync(path.join(__dirname, '..', root, file), fs.constants.R_OK);
  }
}
console.log('source files readable');
