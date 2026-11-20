'use strict';
const fs = require('node:fs');
const path = require('node:path');
function readJson(file) { return JSON.parse(fs.readFileSync(file, 'utf8')); }
function loadConfig(root = path.join(__dirname, '..')) {
  return { plans: readJson(path.join(root, 'config/plans.json')).plans,
    defaults: readJson(path.join(root, 'config/defaults.json')) };
}
module.exports = { loadConfig, readJson };
