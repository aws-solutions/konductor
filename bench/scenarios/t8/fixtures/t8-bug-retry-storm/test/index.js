'use strict';

const fs = require('node:fs');
const path = require('node:path');
for (const name of fs.readdirSync(__dirname).filter((entry) => entry.endsWith('.test.js'))) {
  require(path.join(__dirname, name));
}
