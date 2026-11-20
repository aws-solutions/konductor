'use strict';

const fs = require('node:fs');
const path = require('node:path');

const CONFIG_DIR = path.join(__dirname, '..', 'config');

// key = value lines, # comments: the old config/app.ini format, read for one more release when app.json is missing.
function parseIni(text) {
  const out = {};
  for (const line of text.split('\n')) {
    const m = line.match(/^\s*([\w.]+)\s*=\s*(.*?)\s*$/);
    if (m && !line.trim().startsWith('#')) out[m[1]] = m[2];
  }
  return out;
}

// Reads config/app.json (one object, the same dotted keys as app.ini), else config/app.ini. Every module reads
// settings through get().
function load(dir = CONFIG_DIR) {
  const json = path.join(dir, 'app.json');
  if (fs.existsSync(json)) return JSON.parse(fs.readFileSync(json, 'utf8'));
  return parseIni(fs.readFileSync(path.join(dir, 'app.ini'), 'utf8'));
}

const values = load();

function get(key, fallback) {
  return Object.prototype.hasOwnProperty.call(values, key) ? values[key] : fallback;
}

module.exports = { get, load };
