'use strict';

const fs = require('node:fs');
const path = require('node:path');

// Reads config/app.ini (key = value lines, # comments). Every module reads settings through get().
function load(file = path.join(__dirname, '..', 'config', 'app.ini')) {
  const out = {};
  for (const line of fs.readFileSync(file, 'utf8').split('\n')) {
    const m = line.match(/^\s*([\w.]+)\s*=\s*(.*?)\s*$/);
    if (m && !line.trim().startsWith('#')) out[m[1]] = m[2];
  }
  return out;
}

const values = load();

function get(key, fallback) {
  return Object.prototype.hasOwnProperty.call(values, key) ? values[key] : fallback;
}

module.exports = { get, load };
