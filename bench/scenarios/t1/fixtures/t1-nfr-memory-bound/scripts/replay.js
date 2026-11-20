const { readFileSync } = require('node:fs');
const { createWebhookWorker } = require('../src/webhook-worker');

const file = process.argv[2];
if (!file) {
  console.error('usage: node scripts/replay.js FILE');
  process.exitCode = 2;
} else {
  const worker = createWebhookWorker({ handle: async payload => console.log(payload.type) });
  worker.accept(JSON.parse(readFileSync(file, 'utf8'))).catch(error => {
    console.error(error.message);
    process.exitCode = 1;
  });
}
