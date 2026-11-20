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

test('queue listDeadLetters returns dead-lettered jobs', async () => {
  const temp = await temporaryQueue();
  try {
    const queue = new JobQueue({ filePath: temp.filePath });
    await queue.deadLetter({ id: 'd1', type: 'failed', payload: {}, attempts: 3 }, 'exhausted retries');
    const dead = await queue.listDeadLetters();
    assert.equal(dead.length, 1);
    assert.equal(dead[0].id, 'd1');
    assert.equal(dead[0].reason, 'exhausted retries');
  } finally { await removeTemporaryQueue(temp.directory); }
});

test('queue nextAvailableAt returns earliest availableAt or null', async () => {
  const temp = await temporaryQueue();
  try {
    const queue = new JobQueue({ filePath: temp.filePath });
    
    // Empty queue returns null
    assert.equal(await queue.nextAvailableAt(), null);
    
    // Job without availableAt returns null (immediately available)
    await queue.enqueue({ id: 'j1', type: 'test', payload: {} });
    assert.equal(await queue.nextAvailableAt(), null);
    
    // Clear and add job with availableAt
    await queue.takeNext(); // Remove j1
    await queue.requeue({ id: 'j2', type: 'test', payload: {}, attempts: 1, availableAt: 5000 });
    assert.equal(await queue.nextAvailableAt(), 5000);
    
    // Add job with earlier availableAt
    await queue.requeue({ id: 'j3', type: 'test', payload: {}, attempts: 1, availableAt: 3000 });
    assert.equal(await queue.nextAvailableAt(), 3000);
  } finally { await removeTemporaryQueue(temp.directory); }
});
