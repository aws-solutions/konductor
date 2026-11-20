'use strict';

const path = require('node:path');
const { parseArgs } = require('node:util');
const { loadConfig, DEFAULTS } = require('./config');
const { resolveEnvValues, optionToEnvName } = require('./env');
const { filesBelow } = require('./file-tree');
const { listObjects, uploadFiles } = require('./storage');
const { summary } = require('./format');
const { createLogger } = require('./logger');

/**
 * Parse command line arguments.
 * @param {string[]} args - Command line arguments
 * @returns {object} - Parsed arguments object
 */
function parseCommandLine(args) {
  return parseArgs({
    args,
    allowPositionals: true,
    options: {
      config: { type: 'string' },
      source: { type: 'string' },
      bucket: { type: 'string' },
      prefix: { type: 'string' },
      region: { type: 'string' },
      dryRun: { type: 'boolean' },
      'no-dry-run': { type: 'boolean' },
      verbose: { type: 'boolean' },
      tag: { type: 'string', multiple: true },
      concurrency: { type: 'string' },
      'show-config': { type: 'boolean' }
    }
  });
}

/**
 * Resolve a single option value with proper precedence.
 * @param {string} key - The option key (in CLI format, e.g., 'dryRun')
 * @param {object} cliValues - Parsed CLI values
 * @param {object} envResolved - Environment-resolved values (with .values and .sources)
 * @param {object} configValues - Loaded JSON config values
 * @param {object} defaults - Default values
 * @returns {object} - { value, source }
 */
function resolveOption(cliKey, cliValues, envResolved, configValues, defaults) {
  // Convert camelCase to kebab-case for env lookup
  let envKey = cliKey.replace(/([A-Z])/g, '-$1').toLowerCase();
  
  // Special case: tags -> tag (env var is SYNCER_TAG)
  if (envKey === 'tags') envKey = 'tag';
  
  const envValues = envResolved.values || {};
  
  // CLI first (handle --no-dry-run specially)
  if (cliKey === 'dryRun') {
    if (cliValues['dryRun'] === true) return { value: true, source: 'command line' };
    if (cliValues['no-dry-run'] === true) return { value: false, source: 'command line' };
  } else if (cliKey === 'tags') {
    // Tags are handled specially via 'tag' CLI option
    if (cliValues.tag && cliValues.tag.length > 0) {
      return { value: cliValues.tag, source: 'command line' };
    }
  } else if (cliKey === 'showConfig') {
    // showConfig uses kebab-case in CLI
    if (cliValues['show-config'] === true) {
      return { value: true, source: 'command line' };
    }
  } else {
    const cliValue = cliValues[cliKey];
    if (cliValue !== undefined) {
      return { value: cliValue, source: 'command line' };
    }
  }
  
  // Environment second
  const envValue = envValues[envKey];
  if (envValue !== undefined) {
    return { value: envValue, source: 'environment' };
  }
  
  // Config file third
  const configValue = configValues[cliKey];
  if (configValue !== undefined) {
    return { value: configValue, source: 'config' };
  }
  
  // Defaults last
  const defaultValue = defaults[cliKey];
  return { value: defaultValue, source: 'default' };
}

/**
 * Print configuration to stdout.
 * @param {object} resolved - All resolved values with sources
 */
function showConfiguration(resolved) {
  const displayKeys = ['source', 'bucket', 'prefix', 'region', 'dryRun', 'verbose', 'tags', 'concurrency'];
  const displayNames = { dryRun: 'dry-run', tags: 'tag' };
  
  for (const key of displayKeys) {
    const displayName = displayNames[key] || key;
    const { value, source } = resolved[key];
    const displayValue = Array.isArray(value) ? value.join(',') : value;
    console.log(`${displayName}=${displayValue} [${source}]`);
  }
}

/**
 * Main entry point.
 * @param {string[]} args - Command line arguments
 * @returns {Promise<number>} - Exit code
 */
async function main(args) {
  const parsed = parseCommandLine(args);
  const command = parsed.positionals[0];
  
  if (!['sync', 'list'].includes(command)) {
    throw new Error('command must be sync or list');
  }
  
  // Resolve config path: CLI first, then environment, then default
  const prefixForConfig = process.env.SYNCER_CONFIG && process.env.SYNCER_CONFIG !== '' 
    ? '' 
    : 'SYNCER_';
  const envConfig = process.env.SYNCER_CONFIG && process.env.SYNCER_CONFIG !== ''
    ? process.env.SYNCER_CONFIG
    : undefined;
  const configPath = parsed.values.config || envConfig || '.syncerrc.json';
  
  // Load config file to get envPrefix and other settings
  const configFile = loadConfig(configPath);
  const envPrefix = configFile.envPrefix || 'SYNCER_';
  
  // Resolve environment values using the prefix from config
  const envValues = resolveEnvValues({ envPrefix });
  
  // Resolve all options with proper precedence
  const resolved = {};
  const optionKeys = ['source', 'bucket', 'prefix', 'region', 'dryRun', 'verbose', 'tags', 'concurrency', 'showConfig'];
  
  for (const key of optionKeys) {
    resolved[key] = resolveOption(key, parsed.values, envValues, configFile, DEFAULTS);
  }
  
  // Handle --show-config
  if (resolved.showConfig.value) {
    showConfiguration(resolved);
    return 0;
  }
  
  const values = {
    source: resolved.source.value,
    bucket: resolved.bucket.value,
    prefix: resolved.prefix.value,
    region: resolved.region.value,
    dryRun: resolved.dryRun.value,
    verbose: resolved.verbose.value,
    tags: resolved.tags.value,
    concurrency: resolved.concurrency.value
  };
  
  const logger = createLogger(values.verbose);
  
  if (command === 'list') {
    const objects = await listObjects(values);
    for (const object of objects) console.log(`${object.key}\t${object.size}`);
    return 0;
  }
  
  const source = path.resolve(values.source);
  const files = await filesBelow(source);
  const records = files.map((file) => ({
    relative: path.relative(source, file),
    size: require('node:fs').statSync(file).size
  }));
  logger.info(`found ${records.length} file(s)`);
  
  const objects = await uploadFiles(records, values);
  console.log(`${summary(objects, values.dryRun)} to ${values.bucket}/${values.prefix || ''}`);
  return 0;
}

module.exports = { main, parseCommandLine, resolveOption, showConfiguration };
