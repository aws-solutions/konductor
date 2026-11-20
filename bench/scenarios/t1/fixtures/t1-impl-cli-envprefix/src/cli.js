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
      concurrency: { type: 'string' }
    }
  });
}

async function main(args) {
  const parsed = parseCommandLine(args);
  const command = parsed.positionals[0];
  if (!['sync', 'list'].includes(command)) throw new Error('command must be sync or list');
  const config = loadConfig(parsed.values.config || '.syncerrc.json');
  const values = {
    ...config,
    ...parsed.values,
    tags: parsed.values.tag || config.tags || []
  };
  const logger = createLogger(values.verbose);
  if (command === 'list') {
    const objects = await listObjects(values);
    for (const object of objects) console.log(`${object.key}	${object.size}`);
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
