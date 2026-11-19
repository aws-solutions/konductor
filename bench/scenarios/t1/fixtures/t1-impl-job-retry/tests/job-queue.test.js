const test = require('node:test');
const assert = require('node:assert/strict');
const { JobQueue } = require('../src/job-queue');
const { temporaryQueue, removeTemporaryQueue } = require('./helpers');

test('queue persists a job and increments attempts when taken', async () => {
  const temp = await temporaryQueue();
  try {
    const queue = new JobQueue({ filePath: temp.filePath });
    await queue.enqueue({ id: 'j1', type: 'inventory.sync', payload: { warehouse: 'east' } });
    const job = await queue.takeNext();
    assert.equal(job.id, 'j1');
    assert.equal(job.attempts, 1);
    assert.equal(await queue.size(), 0);
  } finally { await removeTemporaryQueue(temp.directory); }
});

test('queue can put a job back and list it', async () => {
  const temp = await temporaryQueue();
  try {
    const queue = new JobQueue({ filePath: temp.filePath });
    const job = { id: 'j2', type: 'shipment.create', payload: {}, attempts: 1 };
    await queue.requeue(job);
    assert.deepEqual(await queue.list(), [job]);
  } finally { await removeTemporaryQueue(temp.directory); }
});
