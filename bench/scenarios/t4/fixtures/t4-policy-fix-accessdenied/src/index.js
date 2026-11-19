'use strict';

const { FakeCloudClient } = require('./fake-cloud-client');
const { runExport } = require('./export-job');

async function main() {
  const dateArg = process.argv.indexOf('--date');
  const date = dateArg === -1 ? undefined : process.argv[dateArg + 1];
  const client = new FakeCloudClient();
  const result = await runExport(client, { date });
  process.stdout.write(`${JSON.stringify(result)}\n`);
}

if (require.main === module) {
  main().catch((error) => {
    process.stderr.write(`${error.stack}\n`);
    process.exitCode = 1;
  });
}

module.exports = { main };
