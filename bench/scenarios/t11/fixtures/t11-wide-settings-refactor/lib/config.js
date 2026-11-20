'use strict';

const fs = require('node:fs');
const path = require('node:path');
const values = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'config', 'app.json'), 'utf8'));

/**
 * Read a setting from app.json. The first dotted part is the section; all
 * remaining dotted parts form the key, so a.b.c means section a and key b.c.
 * A fallback is used only when the resolved value is undefined.
 */
function value(section, key, { fallback } = {}) {
  let current = values[section];
  for (const part of key.split('.')) {
    if (current === null || current === undefined) return fallback;
    current = current[part];
  }
  return current === undefined ? fallback : current;
}

module.exports = { value };
