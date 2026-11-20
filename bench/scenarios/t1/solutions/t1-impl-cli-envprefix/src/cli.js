'use strict';

const fs = require('node:fs');
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
      prefix: { type: 'string' }, region: { type: 'string' }, 'dry-run': { type: 'boolean' }, 'no-dry-run': { type: 'boolean' },
      verbose: { type: 'boolean' }, 'no-verbose': { type: 'boolean' }, tag: { type: 'string', multiple: true },
      concurrency: { type: 'string' }, 'show-config': { type: 'boolean' }, 'no-show-config': { type: 'boolean' }
    }
  });
}

function displayValue(key, value) {
  if (key === 'tags') return value.join(',');
  return String(value);
}

function printConfig(values, sources) {
  for (const key of ['source', 'bucket', 'prefix', 'region', 'dryRun', 'verbose', 'tags', 'concurrency']) {
    const optionName = key === 'tags' ? 'tag' : key.replaceAll(/[A-Z]/g, (letter) => `-${letter.toLowerCase()}`);
    console.log(`${optionName}=${displayValue(key, values[key])} [${sources[key]}]`);
  }
}

async function main(args, environment = process.env) {
  const parsed = parseCommandLine(args);
  const command = parsed.positionals[0];
  if (!['sync', 'list'].includes(command)) throw new Error('command must be sync or list');
  const loaded = loadConfig('.syncerrc.json', environment, parsed.values);
  const values = loaded.values;
  const logger = createLogger(values.verbose);
  if (values.showConfig) {
    printConfig(values, loaded.sources);
    return 0;
  }
  if (command === 'list') {
    const objects = await listObjects(values);
    for (const object of objects) console.log(`${object.key}\t${object.size}`);
    return 0;
  }
  const source = path.resolve(values.source);
  const files = await filesBelow(source);
  const records = files.map((file) => ({ relative: path.relative(source, file), size: fs.statSync(file).size }));
  logger.info(`found ${records.length} file(s)`);
  const objects = await uploadFiles(records, values);
  console.log(`${summary(objects, values.dryRun)} to ${values.bucket}/${values.prefix || ''}`);
  return 0;
}

module.exports = { main, parseCommandLine, printConfig };
