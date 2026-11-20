const test = require('node:test');
const assert = require('node:assert/strict');
const { WorkerRunner, retryDelay } = require('../src/runner');
const { PermanentJobError } = require('../src/errors');

test('runner handles a known job', async () => {
  const seen = [];
  const pending = [{ id: 'a', type: 'work', payload: {}, attempts: 0 }];
  const logger = { info() {}, error() {} };
  const runner = new WorkerRunner({
    queue: {
      _state: async () => ({ pending, deadLetter: [] }),
      _save: async () => {},
      requeue: async () => {},
      deadLetter: async () => {},
      nextAvailableAt: async () => null
    },
    handlers: { work: async job => seen.push(job.id) },
    logger
  });
  assert.equal(await runner.runOnce(), true);
  assert.equal(await runner.runOnce(), false);
  assert.deepEqual(seen, ['a']);
});

test('runner reports an unknown job without throwing', async () => {
  const errors = [];
  const pending = [{ id: 'b', type: 'missing', payload: {}, attempts: 0 }];
  const deadLetters = [];
  const runner = new WorkerRunner({
    queue: {
      _state: async () => ({ pending, deadLetter: deadLetters }),
      _save: async () => {},
      requeue: async () => {},
      deadLetter: async (job, reason) => { deadLetters.push({ ...job, reason }); },
      nextAvailableAt: async () => null
    },
    handlers: {},
    logger: { info() {}, error(message, fields) { errors.push({ message, fields }); } }
  });
  assert.equal(await runner.runOnce(), true);
  assert.match(errors[0].fields.error, /Unknown job type/);
});

test('retryDelay calculates exponential backoff with cap', () => {
  const policy = { baseDelayMs: 100, maxDelayMs: 1000, jitter: 0 };
  assert.equal(retryDelay(policy, 1, 0.5), 100);
  assert.equal(retryDelay(policy, 2, 0.5), 200);
  assert.equal(retryDelay(policy, 3, 0.5), 400);
  assert.equal(retryDelay(policy, 4, 0.5), 800);
  // Capped at maxDelayMs
  assert.equal(retryDelay(policy, 5, 0.5), 1000);
});

test('retryDelay applies jitter from random value', () => {
  const policy = { baseDelayMs: 100, maxDelayMs: 10000, jitter: 0.5 };
  assert.equal(retryDelay(policy, 1, 0), 50); // low end: 100 * (1 - 0.5)
  assert.equal(retryDelay(policy, 1, 0.5), 100); // middle: no change
  assert.equal(retryDelay(policy, 1, 1), 150); // high end: 100 * (1 + 0.5)
  assert.equal(retryDelay({ ...policy, maxDelayMs: 120 }, 1, 1), 120); // still capped
});

test('runner retries failed job up to maxAttempts', async () => {
  let attempts = 0;
  let jobAttempts = 0;
  const deadLetters = [];
  
  const getState = () => {
    const pending = jobAttempts < 3 ? [{ id: 'r1', type: 'flaky', payload: {}, attempts: jobAttempts }] : [];
    return { pending, deadLetter: deadLetters };
  };
  
  const runner = new WorkerRunner({
    queue: {
      _state: async () => getState(),
      _save: async () => {},
      requeue: async (job) => { jobAttempts = job.attempts; },
      deadLetter: async (job, reason) => { deadLetters.push({ ...job, reason }); },
      nextAvailableAt: async () => null
    },
    handlers: { flaky: async () => { attempts++; throw new Error('transient'); } },
    logger: { info() {}, error() {} },
    retryPolicies: { flaky: { maxAttempts: 3, baseDelayMs: 10 } },
    clock: { now: () => 1000, sleep: async () => {} },
    random: () => 0.5
  });
  
  // First attempt - fails, retries
  await runner.runOnce();
  assert.equal(attempts, 1);
  
  // Second attempt - fails, retries
  await runner.runOnce();
  assert.equal(attempts, 2);
  
  // Third attempt - fails, goes to dead letter
  await runner.runOnce();
  assert.equal(attempts, 3);
  assert.equal(deadLetters.length, 1);
  assert.equal(deadLetters[0].reason, 'transient');
});

test('runner does not retry PermanentJobError', async () => {
  const deadLetters = [];
  const pending = [{ id: 'p1', type: 'work', payload: {}, attempts: 0 }];
  
  const runner = new WorkerRunner({
    queue: {
      _state: async () => ({ pending, deadLetter: deadLetters }),
      _save: async () => {},
      requeue: async () => {},
      deadLetter: async (job, reason) => { deadLetters.push({ ...job, reason }); },
      nextAvailableAt: async () => null
    },
    handlers: { work: async () => { throw new PermanentJobError('permanent failure'); } },
    logger: { info() {}, error() {} },
    retryPolicies: { work: { maxAttempts: 5, baseDelayMs: 10 } },
    clock: { now: () => 1000, sleep: async () => {} },
    random: () => 0.5
  });
  
  await runner.runOnce();
  assert.equal(deadLetters.length, 1);
  assert.equal(deadLetters[0].reason, 'permanent failure');
});

test('runner does not retry error with retryable === false', async () => {
  const deadLetters = [];
  const pending = [{ id: 'e1', type: 'work', payload: {}, attempts: 0 }];
  
  const error = new Error('non-retryable');
  error.retryable = false;
  
  const runner = new WorkerRunner({
    queue: {
      _state: async () => ({ pending, deadLetter: deadLetters }),
      _save: async () => {},
      requeue: async () => {},
      deadLetter: async (job, reason) => { deadLetters.push({ ...job, reason }); },
      nextAvailableAt: async () => null
    },
    handlers: { work: async () => { throw error; } },
    logger: { info() {}, error() {} },
    retryPolicies: { work: { maxAttempts: 5, baseDelayMs: 10 } },
    clock: { now: () => 1000, sleep: async () => {} },
    random: () => 0.5
  });
  
  await runner.runOnce();
  assert.equal(deadLetters.length, 1);
});

test('runner respects shouldRetry hook', async () => {
  const deadLetters = [];
  const requeued = [];
  const pending = [{ id: 's1', type: 'custom', payload: { retryable: true }, attempts: 0 }];
  
  const runner = new WorkerRunner({
    queue: {
      _state: async () => ({ pending, deadLetter: deadLetters }),
      _save: async () => {},
      requeue: async (job) => { requeued.push(job); pending.push(job); },
      deadLetter: async (job, reason) => { deadLetters.push({ ...job, reason }); },
      nextAvailableAt: async () => null
    },
    handlers: { custom: async (job) => { throw new Error('custom error'); } },
    logger: { info() {}, error() {} },
    retryPolicies: {
      custom: {
        maxAttempts: 5,
        baseDelayMs: 10,
        shouldRetry: async (error, job) => job.payload.retryable === true
      }
    },
    clock: { now: () => 1000, sleep: async () => {} },
    random: () => 0.5
  });
  
  await runner.runOnce();
  assert.equal(requeued.length, 1); // Retried because payload.retryable was true
});

test('runner sets availableAt for delayed retry', async () => {
  const pending = [{ id: 'd1', type: 'delayed', payload: {}, attempts: 0 }];
  const requeued = [];
  
  const runner = new WorkerRunner({
    queue: {
      _state: async () => ({ pending, deadLetter: [] }),
      _save: async () => {},
      requeue: async (job) => { requeued.push(job); },
      deadLetter: async () => {},
      nextAvailableAt: async () => null
    },
    handlers: { delayed: async () => { throw new Error('delayed error'); } },
    logger: { info() {}, error() {} },
    retryPolicies: { delayed: { maxAttempts: 3, baseDelayMs: 100 } },
    clock: { now: () => 5000, sleep: async () => {} },
    random: () => 0.5
  });
  
  await runner.runOnce();
  assert.equal(requeued.length, 1);
  assert.ok(requeued[0].availableAt > 5000); // availableAt should be in the future
});

test('run respects signal abort', async () => {
  const pending = [];
  let sleepCalled = false;
  
  const runner = new WorkerRunner({
    queue: {
      _state: async () => ({ pending, deadLetter: [] }),
      _save: async () => {},
      nextAvailableAt: async () => null
    },
    handlers: {},
    logger: { info() {}, error() {} },
    clock: {
      now: () => 1000,
      sleep: async (ms, signal) => {
        sleepCalled = true;
        throw new Error('Aborted');
      }
    },
    random: () => 0.5
  });
  
  runner.stop();
  await runner.run({ intervalMs: 10 });
  // The test passes if it completes without hanging
});

test('run waits for next available job', async () => {
  const now = 1000;
  const pending = [{ id: 'w1', type: 'wait', payload: {}, attempts: 1, availableAt: now + 100 }];
  let sleepMs = null;
  let callCount = 0;
  
  const runner = new WorkerRunner({
    queue: {
      _state: async () => ({ pending, deadLetter: [] }),
      _save: async () => {},
      nextAvailableAt: async () => {
        callCount++;
        return callCount <= 1 ? now + 100 : null;
      }
    },
    handlers: { wait: async () => {} },
    logger: { info() {}, error() {} },
    retryPolicies: { wait: { maxAttempts: 1 } },
    clock: {
      now: () => now,
      sleep: async (ms) => { sleepMs = ms; runner.stop(); }
    },
    random: () => 0.5
  });
  
  await runner.run({ intervalMs: 250 });
  assert.ok(sleepMs !== null && sleepMs <= 100);
});
