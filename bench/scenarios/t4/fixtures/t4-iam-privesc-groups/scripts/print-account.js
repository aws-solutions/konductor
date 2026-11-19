'use strict';

const fs = require('node:fs');
const path = require('node:path');
const account = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'config', 'account.json'), 'utf8'));
console.log(`${account.environment} / ${account.region} / ${account.accountId}`);
