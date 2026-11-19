'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { DEFAULT_CONFIG } = require('./constants');

function loadConfig(fileName) {
  const file = fileName ? path.resolve(fileName) : path.resolve('config/default.json');
  let parsed;
  try {
    parsed = JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch (error) {
    throw new Error(`Invalid config: cannot read ${file}`);
  }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new Error('Invalid config: expected an object');
  }
  const config = { ...DEFAULT_CONFIG, ...parsed };
  if (config.mode !== 'safe' && config.mode !== 'fast') {
    throw new Error('Invalid config: mode must be "safe" or "fast"');
  }
  if (typeof config.color !== 'boolean') {
    throw new Error('Invalid config: color must be boolean');
  }
  if (typeof config.root !== 'string') {
    throw new Error('Invalid config: root must be a string');
  }
  return config;
}

module.exports = { loadConfig };
