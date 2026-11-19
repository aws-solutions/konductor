const path = require('node:path');

const root = path.resolve(__dirname, '..');
const defaults = require('../config/default.json');

function dataPath() {
  return path.resolve(root, defaults.dataFile);
}

module.exports = { root, defaults, dataPath };
