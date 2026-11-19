'use strict';
const fs = require('node:fs');
function readInput(file) { return fs.readFileSync(file, 'utf8'); }
module.exports = { readInput };
