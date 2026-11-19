const test = require('node:test');
const assert = require('node:assert/strict');
const { Outbox } = require('../src/outbox');
const { tempDirectory, removeDirectory } = require('./helpers');

test('writes and reads notification records', async () => {
  const directory = tempDirectory();
  const outbox = new Outbox(directory);
  try {
    await outbox.enqueue({ jobId: 'job-1', title: 'Standup' });
    await outbox.enqueue({ jobId: 'job-2', title: 'Review' });
    assert.deepEqual(await outbox.list(), [
      { jobId: 'job-1', title: 'Standup' },
      { jobId: 'job-2', title: 'Review' }
    ]);
  } finally {
    await removeDirectory(directory);
  }
});

test('clears an outbox directory', async () => {
  const directory = tempDirectory();
  const outbox = new Outbox(directory);
  try {
    await outbox.enqueue({ jobId: 'cleanup' });
    await outbox.clear();
    assert.deepEqual(await outbox.list(), []);
  } finally {
    await removeDirectory(directory);
  }
});
