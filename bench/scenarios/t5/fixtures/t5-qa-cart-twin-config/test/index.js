'use strict';

const fs = require('node:fs');
for (const file of fs.readdirSync(__dirname).filter((name) => name.endsWith('.test.js')).sort()) {
  require(`./${file}`);
}
