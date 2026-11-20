'use strict';
const path = require('node:path');
const { existsSync } = require('node:fs');

function loadPlugin(name) {
  if (!/^[a-z][a-z0-9-]*$/.test(name)) throw new Error(`Unknown plugin: ${name}`);
  const file = path.join(__dirname, '..', 'plugins', `${name}.js`);
  if (!existsSync(file)) throw new Error(`Unknown plugin: ${name}`);
  return require(file);
}

module.exports = { loadPlugin };
