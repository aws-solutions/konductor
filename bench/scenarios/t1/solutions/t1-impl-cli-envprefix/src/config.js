'use strict';

const fs = require('node:fs');

const DEFAULTS = Object.freeze({
  source: '.', bucket: 'local', prefix: '', region: 'us-east-1',
  dryRun: false, verbose: false, tags: [], concurrency: 4,
  showConfig: false, envPrefix: 'SYNCER_'
});

const SETTINGS = [
  ['source', 'source'], ['bucket', 'bucket'], ['prefix', 'prefix'],
  ['region', 'region'], ['dryRun', 'dry-run'], ['verbose', 'verbose'],
  ['tags', 'tag'], ['concurrency', 'concurrency'], ['showConfig', 'show-config']
];

function readConfig(file) {
  if (!file || !fs.existsSync(file)) return {};
  const text = fs.readFileSync(file, 'utf8');
  return JSON.parse(text);
}

function envName(prefix, option) {
  return `${prefix}${option.replaceAll('-', '_').toUpperCase()}`;
}

function invalidEnvironment(name, detail) {
  throw new Error(`Invalid value for ${name}: ${detail}`);
}

function parseBoolean(raw, name) {
  const normalized = raw.toLowerCase();
  if (['true', '1', 'yes'].includes(normalized)) return true;
  if (['false', '0', 'no'].includes(normalized)) return false;
  invalidEnvironment(name, 'expected true, false, 1, 0, yes, or no');
}

function parseConcurrency(raw, name) {
  if (!/^[0-9]+$/.test(raw)) invalidEnvironment(name, 'expected a positive integer');
  const value = Number(raw);
  if (!Number.isSafeInteger(value) || value < 1) invalidEnvironment(name, 'expected a positive integer');
  return value;
}

function configTags(value) {
  if (Array.isArray(value)) return value.map(String);
  if (typeof value === 'string') return value.split(',').map((item) => item.trim()).filter(Boolean);
  return [];
}

function loadConfig(file = '.syncerrc.json', environment = process.env, commandLine = {}) {
  const defaultConfigEnv = environment.SYNCER_CONFIG;
  const configPath = commandLine.config || (defaultConfigEnv ? defaultConfigEnv : file);
  const fromFile = readConfig(configPath);
  const prefix = typeof fromFile.envPrefix === 'string' && fromFile.envPrefix.length > 0
    ? fromFile.envPrefix : DEFAULTS.envPrefix;
  const values = {};
  const sources = {};

  for (const [key, option] of SETTINGS) {
    let cliKey = key === 'tags' ? 'tag' : (key === 'dryRun' ? 'dry-run' : (key === 'verbose' ? 'verbose' : (key === 'showConfig' ? 'show-config' : key)));
    if ((key === 'dryRun' || key === 'verbose' || key === 'showConfig') && Object.prototype.hasOwnProperty.call(commandLine, `no-${cliKey}`)) cliKey = `no-${cliKey}`;
    const environmentName = envName(prefix, option);
    const hasCli = Object.prototype.hasOwnProperty.call(commandLine, cliKey);
    const hasConfig = Object.prototype.hasOwnProperty.call(fromFile, key);
    const rawEnvironment = environment[environmentName];

    if (hasCli) {
      values[key] = cliKey.startsWith('no-') ? false : commandLine[cliKey];
      sources[key] = 'command line';
    } else if (rawEnvironment !== undefined && rawEnvironment !== '') {
      if (key === 'dryRun' || key === 'verbose' || key === 'showConfig') {
        values[key] = parseBoolean(rawEnvironment, environmentName);
      } else if (key === 'concurrency') {
        values[key] = parseConcurrency(rawEnvironment, environmentName);
      } else if (key === 'tags') {
        values[key] = rawEnvironment.split(',').map((item) => item.trim()).filter(Boolean);
      } else {
        values[key] = rawEnvironment;
      }
      sources[key] = 'environment';
    } else if (hasConfig) {
      values[key] = key === 'tags' ? configTags(fromFile[key]) : fromFile[key];
      sources[key] = 'config';
    } else {
      values[key] = key === 'tags' ? [] : DEFAULTS[key];
      sources[key] = 'default';
    }
  }

  if (typeof values.concurrency === 'string') values.concurrency = parseConcurrency(values.concurrency, 'config concurrency');
  for (const key of ['dryRun', 'verbose', 'showConfig']) {
    if (typeof values[key] !== 'boolean') throw new Error(`config ${key} must be boolean`);
  }
  return { ...values, values, sources, envPrefix: prefix, configPath };
}

module.exports = { DEFAULTS, SETTINGS, envName, loadConfig, readConfig };
