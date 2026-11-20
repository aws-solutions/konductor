'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { parseEnv } = require('./parser');
const { Settings } = require('./settings');

function defaultFiles() {
  const base = path.resolve(process.cwd(), 'config/default.env');
  const local = path.resolve(process.cwd(), 'config/local.env');
  return fs.existsSync(local) ? [base, local] : [base];
}

function expandValue(value, values) {
  return value.replace(/\$\{([A-Za-z_][A-Za-z0-9_]*)\}/g, (_, name) => {
    return values[name] || '';
  });
}

function loadSettings(options = {}) {
  const files = options.files === undefined ? defaultFiles() : options.files;
  const env = options.env === undefined ? process.env : options.env;
  const expand = options.expand === undefined ? true : options.expand;
  if (!Array.isArray(files)) throw new TypeError('files must be an array');
  const values = {};
  const sources = {};
  for (const file of files) {
    const resolved = path.resolve(file);
    const parsed = parseEnv(fs.readFileSync(resolved, 'utf8'), resolved);
    for (const [key, value] of Object.entries(parsed)) {
      values[key] = value;
      sources[key] = resolved;
    }
  }
  for (const key of Object.keys(values)) {
    if (Object.prototype.hasOwnProperty.call(env, key)) {
      values[key] = String(env[key]);
      sources[key] = '<environment>';
    }
  }
  if (expand) {
    for (const key of Object.keys(values)) {
      values[key] = expandValue(values[key], values);
    }
  }
  return new Settings(values, { sources });
}

module.exports = { loadSettings };
