'use strict';

const fs = require('node:fs');
const path = require('node:path');

const file = path.join(__dirname, '..', 'config', 'export.json');
const values = JSON.parse(fs.readFileSync(file, 'utf8'));

module.exports = Object.freeze({
  ...values,
  objectPrefix: `${values.prefix}*`
});
