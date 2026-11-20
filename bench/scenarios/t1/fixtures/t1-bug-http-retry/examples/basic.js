'use strict';

const { request } = require('../src');

async function main() {
  const target = process.env.HARBOR_URL || 'http://127.0.0.1:8080/health';
  const response = await request(target);
  process.stdout.write(`${response.statusCode} ${response.body}\n`);
}

if (require.main === module) main().catch((error) => {
  process.stderr.write(`${error.message}\n`);
  process.exitCode = 1;
});

module.exports = main;
