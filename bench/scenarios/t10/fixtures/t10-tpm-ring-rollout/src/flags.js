'use strict';

const registry = require('../ops/flag-registry.json');

function isRegistered(name) {
  return registry.flags.some((flag) => flag.name === name);
}

function enabled(name, values = {}) {
  return isRegistered(name) && values[name] === true;
}

module.exports = { isRegistered, enabled };
