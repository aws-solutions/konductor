const fs = require('node:fs');
const path = require('node:path');

function readJson(name) {
  const file = path.join(__dirname, '..', 'config', name);
  return JSON.parse(fs.readFileSync(file, 'utf8'));
}

module.exports = {
  defaults: readJson('default.json'),
  flags: readJson('feature-flags.json'),
  settlement: readJson('settlement.json')
};
