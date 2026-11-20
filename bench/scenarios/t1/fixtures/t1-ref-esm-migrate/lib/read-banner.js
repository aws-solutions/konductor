'use strict';
const fs = require('node:fs');
const path = require('node:path');

function readBanner() {
  return fs.readFileSync(path.join(__dirname, 'banner.txt'), 'utf8');
}
module.exports = { readBanner };
