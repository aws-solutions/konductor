'use strict';

const path = require('node:path');
const { parseArgs } = require('node:util');
const { loadConfig } = require('./config');
const { filesBelow } = require('./file-tree');
const { listObjects, uploadFiles } = require('./storage');
const { summary } = require('./format');
const { createLogger } = require('./logger');

function parseCommandLine(args) {
  return parseArgs({
    args,
    allowPositionals: true,
    options: {
      config: { type: 'string' }, source: { type: 'string' }, bucket: { type: 'string' },
      prefix: { type: 'string' }, region: { type: 'string' }, dryRun: { type: 'boolean' },
      verbose: { type: 'boolean' }, tag: { type: 'string', multiple: true },
      concurrency: { type: 'string' }, showConfig: { type: 'boolean' }
    }
  });
}

function getEnvValue(name, prefix) {
  const envName = prefix + name.replace(/-/g, '_').toUpperCase();
  const value = process.env[envName];
  return value === '' ? undefined : value;
}

async function main(args) {
  const parsed = parseCommandLine(args);
  const command = parsed.positionals[0];
  if (!['sync', 'list'].includes(command)) throw new Error('command must be sync or list');
  
  const configPath = parsed.values.config || getEnvValue('config', 'SYNCER_') || '.syncerrc.json';
  const config = loadConfig(configPath);
  const prefix = config.envPrefix || 'SYNCER_';
  
  const values = {
    ...config,
    ...parsed.values,
    tags: parsed.values.tag || config.tags || []
  };
  
  if (parsed.values.showConfig) {
    console.log(`source=${values.source} [config]`);
    console.log(`bucket=${values.bucket} [config]`);
    console.log(`prefix=${values.prefix} [config]`);
    console.log(`region=${values.region} [config]`);
    console.log(`dry-run=${values.dryRun} [config]`);
    console.log(`verbose=${values.verbose} [config]`);
    console.log(`tag=${values.tags.join(',')} [config]`);
    console.log(`concurrency=${values.concurrency} [config]`);
    return 0;
  }
  
  const logger = createLogger(values.verbose);
  if (command === 'list') {
    const objects = await listObjects(values);
    for (const object of objects) console.log(`${object.key}\t${object.size}`);
    return 0;
  }
  const source = path.resolve(values.source);
  const files = await filesBelow(source);
  const records = files.map((file) => ({ relative: path.relative(source, file), size: require('node:fs').statSync(file).size }));
  logger.info(`found ${records.length} file(s)`);
  const objects = await uploadFiles(records, values);
  console.log(`${summary(objects, values.dryRun)} to ${values.bucket}/${values.prefix || ''}`);
  return 0;
}

module.exports = { main, parseCommandLine };
