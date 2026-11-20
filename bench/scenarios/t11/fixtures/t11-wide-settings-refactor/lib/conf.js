'use strict';

const fs = require('node:fs');
const path = require('node:path');
const values = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'config', 'app.json'), 'utf8'));

function read(name, fallback) {
  const parts = name.split('.');
  const section = parts.shift();
  let current = values[section];
  for (const part of parts) {
    if (current === null || current === undefined) return fallback;
    current = current[part];
  }
  return current === undefined ? fallback : current;
}

module.exports = { read };
