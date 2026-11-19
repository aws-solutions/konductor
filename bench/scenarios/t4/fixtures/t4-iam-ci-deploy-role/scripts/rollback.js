'use strict';

const { loadConfig } = require('./lib/config');
const { createCloudClient } = require('./lib/cloud-client');

async function rollback({ stage, client = createCloudClient(), version = process.env.ROLLBACK_VERSION || '16' }) {
  const config = loadConfig(stage);
  client.updateAlias(config.aliasArn, { functionVersion: String(version) });
  return { stage, alias: config.aliasArn, version: String(version) };
}

if (require.main === module) {
  rollback({ stage: process.argv[2] }).then((result) => process.stdout.write(`${JSON.stringify(result)}\n`)).catch((error) => {
    process.stderr.write(`${error.stack || error}\n`);
    process.exitCode = 1;
  });
}

module.exports = { rollback };
