const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { JobQueue } = require('../src/job-queue');
const { WorkerRunner, retryDelay } = require('../src/runner');
const { PermanentJobError } = require('../src/errors');

async function temp() {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'worker-hidden-'));
  return { directory, filePath: path.join(directory, 'jobs.json') };
}
function log() { return { info() {}, error() {} }; }
async function clean(t) { await fs.rm(t.directory, { recursive: true, force: true }); }
function clock(value = 0) {
  return { value, now() { return this.value; }, sleep: async function (ms) { this.value += ms; } };
}

// The queue is reopened between attempts here to verify that retry state is durable.
test('retry state and attempts survive reopening the queue', async () => {
  const t = await temp();
  try {
    let now = 10;
    const q = new JobQueue({ filePath: t.filePath });
    await q.enqueue({ id: 'persist', type: 'flaky', payload: {} });
    const first = new WorkerRunner({ queue: q, handlers: { flaky: async () => { throw new Error('temporary'); } }, retryPolicies: { flaky: { maxAttempts: 2, baseDelayMs: 25 } }, clock: { now: () => now, sleep: async () => {} }, logger: log() });
    await first.runOnce();
    const reopened = new JobQueue({ filePath: t.filePath });
    const waiting = await reopened.list();
    assert.equal(waiting[0].attempts, 1);
    assert.equal(waiting[0].availableAt, 35);
    now = 35;
    const second = new WorkerRunner({ queue: reopened, handlers: { flaky: async () => {} }, retryPolicies: { flaky: { maxAttempts: 2, baseDelayMs: 25 } }, clock: { now: () => now, sleep: async () => {} }, logger: log() });
    await second.runOnce();
    assert.equal(await reopened.size(), 0);
  } finally { await clean(t); }
});

test('policies are selected by job type', async () => {
  const t = await temp();
  try {
    const q = new JobQueue({ filePath: t.filePath });
    await q.enqueue({ id: 'retry', type: 'retrying', payload: {} });
    await q.enqueue({ id: 'once', type: 'one-shot', payload: {} });
    const runner = new WorkerRunner({ queue: q, handlers: { retrying: async () => { throw new Error('no'); }, 'one-shot': async () => { throw new Error('stop'); } }, retryPolicies: { retrying: { maxAttempts: 2, baseDelayMs: 0 } }, clock: { now: () => 0, sleep: async () => {} }, logger: log() });
    await runner.runOnce();
    await runner.runOnce();
    const pending = await q.list();
    const dead = await q.listDeadLetters();
    assert.equal(pending[0].id, 'retry');
    assert.equal(pending[0].attempts, 1);
    assert.equal(dead[0].id, 'once');
  } finally { await clean(t); }
});

test('a missing policy means one total attempt', async () => {
  const t = await temp();
  try {
    const q = new JobQueue({ filePath: t.filePath });
    await q.enqueue({ id: 'default', type: 'work', payload: {} });
    const runner = new WorkerRunner({ queue: q, handlers: { work: async () => { throw new Error('failed once'); } }, clock: { now: () => 0, sleep: async () => {} }, logger: log() });
    await runner.runOnce();
    assert.equal(await q.size(), 0);
    assert.equal((await q.listDeadLetters())[0].attempts, 1);
  } finally { await clean(t); }
});

test('PermanentJobError bypasses a retry policy', async () => {
  const t = await temp();
  try {
    const q = new JobQueue({ filePath: t.filePath });
    await q.enqueue({ id: 'bad', type: 'work', payload: {} });
    let calls = 0;
    const runner = new WorkerRunner({ queue: q, handlers: { work: async () => { calls++; throw new PermanentJobError('bad address', 'ADDRESS_INVALID'); } }, retryPolicies: { work: { maxAttempts: 5, baseDelayMs: 1 } }, clock: { now: () => 0, sleep: async () => {} }, logger: log() });
    await runner.runOnce();
    assert.equal(calls, 1);
    assert.deepEqual(await q.listDeadLetters(), [{ id: 'bad', type: 'work', payload: {}, attempts: 1, reason: 'bad address' }]);
  } finally { await clean(t); }
});

test('retryable false bypasses a retry policy', async () => {
  const t = await temp();
  try {
    const q = new JobQueue({ filePath: t.filePath });
    await q.enqueue({ id: 'bad-flag', type: 'work', payload: {} });
    const error = Object.assign(new Error('do not repeat'), { retryable: false });
    const runner = new WorkerRunner({ queue: q, handlers: { work: async () => { throw error; } }, retryPolicies: { work: { maxAttempts: 8, baseDelayMs: 1 } }, clock: { now: () => 0, sleep: async () => {} }, logger: log() });
    await runner.runOnce();
    assert.equal((await q.listDeadLetters())[0].reason, 'do not repeat');
  } finally { await clean(t); }
});

test('maxAttempts includes the first execution', async () => {
  const t = await temp();
  try {
    const q = new JobQueue({ filePath: t.filePath });
    await q.enqueue({ id: 'limited', type: 'work', payload: {} });
    let now = 0;
    const runner = new WorkerRunner({ queue: q, handlers: { work: async () => { throw new Error('still down'); } }, retryPolicies: { work: { maxAttempts: 3, baseDelayMs: 1 } }, clock: { now: () => now, sleep: async () => {} }, logger: log() });
    for (let i = 0; i < 3; i++) { await runner.runOnce(); const jobs = await q.list(); if (jobs.length) now = jobs[0].availableAt; }
    assert.equal((await q.listDeadLetters())[0].attempts, 3);
    assert.equal(await q.size(), 0);
  } finally { await clean(t); }
});

test('exponential delay starts at base and is capped', async () => {
  const t = await temp();
  try {
    const q = new JobQueue({ filePath: t.filePath });
    await q.enqueue({ id: 'backoff', type: 'work', payload: {} });
    let now = 100;
    const runner = new WorkerRunner({ queue: q, handlers: { work: async () => { throw new Error('down'); } }, retryPolicies: { work: { maxAttempts: 4, baseDelayMs: 10, maxDelayMs: 25 } }, clock: { now: () => now, sleep: async () => {} }, random: () => 0.5, logger: log() });
    await runner.runOnce();
    assert.equal((await q.list())[0].availableAt, 110);
    now = 110;
    await runner.runOnce();
    assert.equal((await q.list())[0].availableAt, 130);
    now = 130;
    await runner.runOnce();
    assert.equal((await q.list())[0].availableAt, 155);
  } finally { await clean(t); }
});

test('jitter uses the injected random source', () => {
  assert.equal(retryDelay({ baseDelayMs: 100, maxDelayMs: 1000, jitter: 0.25 }, 1, 0), 75);
  assert.equal(retryDelay({ baseDelayMs: 100, maxDelayMs: 1000, jitter: 0.25 }, 1, 1), 125);
});

test('retry hook receives the error and job and can allow retry', async () => {
  const t = await temp();
  try {
    const q = new JobQueue({ filePath: t.filePath });
    await q.enqueue({ id: 'hook', type: 'work', payload: { n: 2 } });
    let received;
    const runner = new WorkerRunner({ queue: q, handlers: { work: async () => { throw new Error('temporary'); } }, retryPolicies: { work: { maxAttempts: 2, shouldRetry: (error, job) => { received = [error.message, job.id, job.attempts]; return true; } } }, clock: { now: () => 0, sleep: async () => {} }, logger: log() });
    await runner.runOnce();
    assert.deepEqual(received, ['temporary', 'hook', 1]);
    assert.equal((await q.list()).length, 1);
  } finally { await clean(t); }
});

test('retry hook can reject an otherwise retryable error', async () => {
  const t = await temp();
  try {
    const q = new JobQueue({ filePath: t.filePath });
    await q.enqueue({ id: 'reject', type: 'work', payload: {} });
    let hookCalls = 0;
    const runner = new WorkerRunner({ queue: q, handlers: { work: async () => { throw new Error('ignore me'); } }, retryPolicies: { work: { maxAttempts: 4, shouldRetry: () => { hookCalls++; return false; } } }, clock: { now: () => 0, sleep: async () => {} }, logger: log() });
    await runner.runOnce();
    assert.equal(hookCalls, 1);
    assert.equal((await q.listDeadLetters())[0].reason, 'ignore me');
  } finally { await clean(t); }
});

test('dead-letter reason is retained after the last allowed attempt', async () => {
  const t = await temp();
  try {
    const q = new JobQueue({ filePath: t.filePath });
    await q.enqueue({ id: 'reason', type: 'work', payload: {} });
    const runner = new WorkerRunner({ queue: q, handlers: { work: async () => { throw new Error('warehouse closed'); } }, retryPolicies: { work: { maxAttempts: 1 } }, clock: { now: () => 0, sleep: async () => {} }, logger: log() });
    await runner.runOnce();
    const dead = await q.listDeadLetters();
    assert.equal(dead.length, 1);
    assert.equal(dead[0].reason, 'warehouse closed');
    assert.equal(dead[0].attempts, 1);
  } finally { await clean(t); }
});

test('stopping while a retry is waiting leaves it on disk', async () => {
  const t = await temp();
  try {
    const q = new JobQueue({ filePath: t.filePath });
    await q.enqueue({ id: 'safe-stop', type: 'work', payload: {} });
    let runner;
    const clock = { value: 0, now() { return this.value; }, sleep: async function () { runner.stop(); } };
    runner = new WorkerRunner({ queue: q, handlers: { work: async () => { throw new Error('later'); } }, retryPolicies: { work: { maxAttempts: 2, baseDelayMs: 100 } }, clock, logger: log() });
    const safety = setTimeout(() => runner.stop(), 50);
    await runner.run();
    clearTimeout(safety);
    assert.deepEqual((await q.list()).map(job => [job.id, job.attempts, job.availableAt]), [['safe-stop', 1, 100]]);
  } finally { await clean(t); }
});

test('run waits on the injected clock and then processes the retry', async () => {
  const t = await temp();
  try {
    const q = new JobQueue({ filePath: t.filePath });
    await q.enqueue({ id: 'wait', type: 'work', payload: {} });
    const clock = clockFactory(0);
    let calls = 0;
    const runner = new WorkerRunner({ queue: q, handlers: { work: async () => { calls++; if (calls === 1) throw new Error('once'); } }, retryPolicies: { work: { maxAttempts: 2, baseDelayMs: 40 } }, clock, logger: log() });
    const safety = setTimeout(() => runner.stop(), 50);
    await runner.run();
    clearTimeout(safety);
    assert.equal(calls, 2);
    assert.equal(clock.sleeps[0], 40);
    assert.equal(await q.size(), 0);
  } finally { await clean(t); }
});
function clockFactory(value) {
  return { value, sleeps: [], now() { return this.value; }, sleep: async function (ms) { this.sleeps.push(ms); this.value += ms; } };
}

test('queue does not take a job before availableAt', async () => {
  const t = await temp();
  try {
    const q = new JobQueue({ filePath: t.filePath });
    await q.enqueue({ id: 'future', type: 'work', payload: {}, attempts: 1, availableAt: 50 });
    assert.equal(await q.takeNext(49), null);
    assert.equal((await q.nextAvailableAt()), 50);
    assert.equal((await q.takeNext(50)).attempts, 2);
  } finally { await clean(t); }
});
