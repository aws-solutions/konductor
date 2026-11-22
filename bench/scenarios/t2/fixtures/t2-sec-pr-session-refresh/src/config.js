'use strict';

const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const policy = JSON.parse(fs.readFileSync(path.join(root, 'config/session-policy.json'), 'utf8'));
const runtime = JSON.parse(fs.readFileSync(path.join(root, 'config/runtime.json'), 'utf8'));

function readConfig() {
  return {
    ...policy,
    ...runtime,
    now: () => Date.now()
  };
}

module.exports = { readConfig };
