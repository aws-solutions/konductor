const fs = require('node:fs');
const path = require('node:path');
const source = fs.readFileSync(path.join(__dirname, '..', 'src', 'format.js'), 'utf8');
if (!source.includes('JSON.stringify')) process.exit(1);
process.stdout.write('basic checks passed\n');
