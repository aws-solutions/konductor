'use strict';

const fs = require('node:fs');
const path = require('node:path');
const file = path.join(__dirname, '..', 'ops', 'metrics-catalogue.csv');
const lines = fs.readFileSync(file, 'utf8').trim().split('\n');
if (lines[0] !== 'name,unit,meaning' || lines.slice(1).some((line) => line.split(',').length < 3)) process.exit(1);
console.log('catalogue ok');
