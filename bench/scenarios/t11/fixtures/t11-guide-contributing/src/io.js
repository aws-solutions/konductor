'use strict';
const fs = require('node:fs');
function readCueFile(file) { return fs.readFileSync(file, 'utf8'); }
function writeCueFile(file, text) { fs.writeFileSync(file, text + '\n'); }
module.exports = { readCueFile, writeCueFile };
