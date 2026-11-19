const fs = require('node:fs');

function loadPublicKey(file) {
  return fs.readFileSync(file, 'utf8');
}

function keyIdFor(environment) {
  return environment === 'production' ? 'roster-primary' : 'roster-test';
}

module.exports = { loadPublicKey, keyIdFor };
