'use strict';

const fs = require('node:fs');

const readLines = (file) => fs.readFileSync(file, 'utf8').split('\n');
const writeFile = (file, text) => fs.writeFileSync(file, text);

module.exports = { readLines, writeFile };
