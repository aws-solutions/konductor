'use strict';
const fs = require('node:fs');
for (const name of fs.readdirSync(__dirname).filter(name => name.endsWith('.test.js'))) require('./' + name);
