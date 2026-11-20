'use strict';

const fs = require('node:fs');
const path = require('node:path');

const root = path.join(__dirname, '..', 'src');
const files = fs.readdirSync(root).filter((name) => name.endsWith('.js'));
if (files.length < 5) process.exit(1);
console.log(`checked ${files.length} source files`);
