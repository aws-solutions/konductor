'use strict';

const fs = require('node:fs');
const path = require('node:path');
const readme = fs.readFileSync(path.join(__dirname, '..', 'README.md'), 'utf8');
if (!readme.includes('docs/api.md')) process.exitCode = 1;
