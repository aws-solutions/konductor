const test = require('node:test');
const assert = require('node:assert/strict');
const { WorkerRunner, retryDelay } = require('../src/runner');

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
    queue: {
      takeNext: async () => ({ id: 'b', type: 'missing', payload: {}, attempts: 1 }),
      requeue: async () => {},
      deadLetter: async () => {}
    },
    handlers: {},
    logger: { info() {}, error(message, fields) { errors.push({ message, fields }); } }
  });
  assert.equal(await runner.runOnce(), true);
  assert.match(errors[0].fields.error, /Unknown job type/);
});

test('retryDelay calculates exponential backoff', () => {
  const policy = { baseDelayMs: 100, maxDelayMs: 10000 };
  assert.equal(retryDelay(policy, 1, 0.5), 100);
  assert.equal(retryDelay(policy, 2, 0.5), 200);
  assert.equal(retryDelay(policy, 3, 0.5), 400);
});

test('runner retries failed job up to maxAttempts', async () => {
  const jobs = [
    { id: 'r1', type: 'flaky', payload: {}, attempts: 1 },
    { id: 'r1', type: 'flaky', payload: {}, attempts: 2 },
    null
  ];
  let idx = 0;
  const requeued = [];
  const deadLettered = [];
  const runner = new WorkerRunner({
    queue: {
      takeNext: async () => jobs[idx++],
      requeue: async (job) => requeued.push(job),
      deadLetter: async (job, reason) => deadLettered.push({ job, reason })
    },
    handlers: { flaky: async () => { throw new Error('transient'); } },
    logger: { info() {}, error() {} },
    retryPolicies: { flaky: { maxAttempts: 2, baseDelayMs: 100 } }
  });
  await runner.runOnce();
  await runner.runOnce();
  assert.equal(requeued.length, 1);
  assert.equal(deadLettered.length, 1);
});
