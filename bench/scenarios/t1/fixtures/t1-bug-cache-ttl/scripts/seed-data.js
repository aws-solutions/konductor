'use strict';

const fs = require('node:fs');
const path = require('node:path');

const output = path.join(__dirname, '..', 'data', 'profiles.json');
const records = JSON.parse(fs.readFileSync(output, 'utf8'));
console.log(`Loaded ${records.length} profile records from ${output}`);
