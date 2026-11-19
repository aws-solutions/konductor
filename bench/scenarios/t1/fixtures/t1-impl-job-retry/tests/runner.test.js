const test = require('node:test');
const assert = require('node:assert/strict');
const { WorkerRunner } = require('../src/runner');

test('runner handles a known job', async () => {
  const seen = [];
  const logger = { info() {}, error() {} };
  const runner = new WorkerRunner({
    queue: { takeNext: async () => seen.length ? null : { id: 'a', type: 'work', payload: {}, attempts: 1 } },
    handlers: { work: async job => seen.push(job.id) },
    logger
  });
  assert.equal(await runner.runOnce(), true);
  assert.equal(await runner.runOnce(), false);
  assert.deepEqual(seen, ['a']);
});

test('runner reports an unknown job without throwing', async () => {
  const errors = [];
  const runner = new WorkerRunner({
    queue: { takeNext: async () => ({ id: 'b', type: 'missing', payload: {}, attempts: 1 }) },
    handlers: {},
    logger: { info() {}, error(message, fields) { errors.push({ message, fields }); } }
  });
  assert.equal(await runner.runOnce(), true);
  assert.match(errors[0].fields.error, /Unknown job type/);
});
