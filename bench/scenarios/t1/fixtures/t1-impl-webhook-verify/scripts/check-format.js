const fs = require('node:fs');
const path = require('node:path');
const src = path.join(__dirname, '..', 'src');
const files = fs.readdirSync(src, { recursive: true }).filter((name) => name.endsWith('.js'));
if (files.length < 10) throw new Error('source tree is unexpectedly small');
process.stdout.write(`checked ${files.length} source files\n`);
