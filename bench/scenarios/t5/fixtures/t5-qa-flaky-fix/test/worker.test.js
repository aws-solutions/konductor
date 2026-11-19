const test = require('node:test');
const assert = require('node:assert/strict');
const { createApplication } = require('../src');
const { processBatch } = require('../src/worker');
const { Outbox } = require('../src/outbox');
const { RateLimiter } = require('../src/rate-limiter');
const { tempDirectory, removeDirectory } = require('./helpers');

test('processes a batch of due jobs', async () => {
  const directory = tempDirectory();
  try {
    const app = createApplication({ outbox: new Outbox(directory), limiter: new RateLimiter(3, 1000) });
    const sent = await processBatch(app, [{ id: 'batch-1', title: 'One', rule: { weekday: 'Wednesday', hour: 14, minute: 0 } }], new Date('2026-04-08T14:00:00Z'));
    assert.equal(sent[0].jobId, 'batch-1');
  } finally {
    await removeDirectory(directory);
  }
});
