'use strict';

const path = require('node:path');

function rolePolicy(name) {
  if (!/^[a-z0-9-]+$/.test(name)) throw new TypeError('invalid role policy name');
  return path.join(__dirname, '..', 'infra', 'roles', `${name}.json`);
}

module.exports = { rolePolicy };
