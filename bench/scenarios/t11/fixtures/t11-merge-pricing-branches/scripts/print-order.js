'use strict';

const fs = require('node:fs');
const { calculateOrder } = require('../src');
const input = JSON.parse(fs.readFileSync(0, 'utf8'));
process.stdout.write(`${JSON.stringify(calculateOrder(input))}\n`);
