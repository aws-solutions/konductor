'use strict';

const fs = require('node:fs');

const DEFAULTS = Object.freeze({
  source: '.', bucket: 'local', prefix: '', region: 'us-east-1',
  dryRun: false, verbose: false, tags: [], concurrency: 4,
  envPrefix: 'SYNCER_'
});

function readConfig(file) {
  if (!file || !fs.existsSync(file)) return {};
  const text = fs.readFileSync(file, 'utf8');
  return JSON.parse(text);
}

function loadConfig(file = '.syncerrc.json') {
  const fromFile = readConfig(file);
  return { ...DEFAULTS, ...fromFile, configPath: file };
}

module.exports = { DEFAULTS, loadConfig, readConfig };
