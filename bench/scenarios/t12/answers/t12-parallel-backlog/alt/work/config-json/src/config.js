'use strict';

const fs = require('node:fs');
const path = require('node:path');

const DIR = path.join(__dirname, '..', 'config');

// config/app.json nests the settings by their first name part ({"session": {"ttlMinutes": 30}}); get() takes the
// dotted names as before. Flattening keeps every caller unchanged.
function flatten(obj, prefix = '', out = {}) {
  for (const [k, v] of Object.entries(obj)) {
    if (v && typeof v === 'object' && !Array.isArray(v)) flatten(v, `${prefix}${k}.`, out);
    else out[`${prefix}${k}`] = v;
  }
  return out;
}

function fromIni(text) {
  const out = {};
  for (const raw of text.split('\n')) {
    const line = raw.trim();
    if (!line || line.startsWith('#')) continue;
    const at = line.indexOf('=');
    if (at > 0) out[line.slice(0, at).trim()] = line.slice(at + 1).trim();
  }
  return out;
}

// app.json first; app.ini only while the old file is still the one deployed (kept for one release).
function load(dir = DIR) {
  const candidates = [['app.json', (t) => flatten(JSON.parse(t))], ['app.ini', fromIni]];
  for (const [name, parse] of candidates) {
    const file = path.join(dir, name);
    if (fs.existsSync(file)) return parse(fs.readFileSync(file, 'utf8'));
  }
  return {};
}

const values = load();

const get = (key, fallback) => (key in values ? values[key] : fallback);

module.exports = { get, load, flatten };
