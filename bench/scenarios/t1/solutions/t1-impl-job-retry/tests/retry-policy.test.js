const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { JobQueue } = require('../src/job-queue');
const { WorkerRunner } = require('../src/runner');
const { PermanentJobError } = require('../src/errors');

async function setup() {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'retry-worker-'));
  return { directory, filePath: path.join(directory, 'jobs.json') };
}
function logger() { return { info() {}, error() {} }; }

test('retries only the configured type and keeps attempts', async () => {
  const temp = await setup();
  try {
    const queue = new JobQueue({ filePath: temp.filePath });
    await queue.enqueue({ id: 'a', type: 'flaky', payload: {} });
    const calls = [];
    const runner = new WorkerRunner({ queue, handlers: { flaky: async job => { calls.push(job.attempts); if (calls.length < 2) throw new Error('temporary'); } }, retryPolicies: { flaky: { maxAttempts: 2, baseDelayMs: 0 } }, clock: { now: () => 0, sleep: async () => {} }, random: () => 0, logger: logger() });
    await runner.runOnce();
    const waiting = await queue.list();
    assert.equal(waiting[0].attempts, 1);
    await runner.runOnce();
    assert.deepEqual(calls, [1, 2]);
    assert.equal((await queue.listDeadLetters()).length, 0);
  } finally { await fs.rm(temp.directory, { recursive: true, force: true }); }
});

test('permanent errors skip retries and preserve the reason', async () => {
  const temp = await setup();
  try {
    const queue = new JobQueue({ filePath: temp.filePath });
    await queue.enqueue({ id: 'p', type: 'work', payload: {} });
    const runner = new WorkerRunner({ queue, handlers: { work: async () => { throw new PermanentJobError('invalid address'); } }, retryPolicies: { work: { maxAttempts: 9, baseDelayMs: 10 } }, logger: logger(), clock: { now: () => 0, sleep: async () => {} } });
    await runner.runOnce();
    assert.equal((await queue.listDeadLetters())[0].reason, 'invalid address');
  } finally { await fs.rm(temp.directory, { recursive: true, force: true }); }
});

test('backoff is capped and uses the injected random source', async () => {
  const temp = await setup();
  try {
    const queue = new JobQueue({ filePath: temp.filePath });
    await queue.enqueue({ id: 'b', type: 'work', payload: {} });
    const runner = new WorkerRunner({ queue, handlers: { work: async () => { throw new Error('again'); } }, retryPolicies: { work: { maxAttempts: 3, baseDelayMs: 10, maxDelayMs: 15, jitter: 0.5 } }, random: () => 0, clock: { now: () => 100, sleep: async () => {} }, logger: logger() });
    await runner.runOnce();
    assert.equal((await queue.list())[0].availableAt, 105);
  } finally { await fs.rm(temp.directory, { recursive: true, force: true }); }
});

test('retry hook can reject a retry', async () => {
  const temp = await setup();
  try {
    const queue = new JobQueue({ filePath: temp.filePath });
    await queue.enqueue({ id: 'h', type: 'work', payload: {} });
    let hookCalled = false;
    const runner = new WorkerRunner({ queue, handlers: { work: async () => { throw new Error('not worth it'); } }, retryPolicies: { work: { maxAttempts: 3, shouldRetry: async () => { hookCalled = true; return false; } } }, logger: logger() });
    await runner.runOnce();
    assert.equal(hookCalled, true);
    assert.equal((await queue.listDeadLetters())[0].reason, 'not worth it');
  } finally { await fs.rm(temp.directory, { recursive: true, force: true }); }
});
