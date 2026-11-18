'use strict';

// The readiness checklist of docs/READINESS.md, one rule per test. Fake queue, handler, log and clock; the only waits
// are short drain bounds, so results do not depend on the host's speed.

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const lib = require('../src');

const KEY = 'test-key-7f3a91';
const ENV = { WORKER_API_KEY: KEY };
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const turns = (n = 5) => new Promise((resolve) => { const step = (k) => (k ? setImmediate(() => step(k - 1)) : resolve()); step(n); });

/** A worker on a fresh queue with a recording log and a fixed clock. `handler` defaults to one that succeeds. */
function make({ env = ENV, handler = async () => {}, now = 1700000000000 } = {}) {
  const queue = lib.createQueue();
  const logs = [];
  const worker = lib.createWorker({ queue, handler, env, log: (e) => logs.push(e), clock: { now: () => now } });
  return { queue, logs, worker };
}

/** A handler whose jobs stay in flight until `release()` is called. */
function gate() {
  let open;
  const opened = new Promise((resolve) => { open = resolve; });
  return { handler: () => opened, release: () => open() };
}

async function finish(t) {
  await t.worker.stop();
  t.queue.close();
}

const configError = (name) => (err) => err instanceof lib.ConfigError && err.message.includes(name);

test('a missing WORKER_API_KEY stops createWorker with a ConfigError that names it', () => {
  assert.equal(typeof lib.ConfigError, 'function', 'ConfigError is exported');
  assert.throws(() => make({ env: {} }), configError('WORKER_API_KEY'));
  assert.throws(() => make({ env: { WORKER_API_KEY: '' } }), configError('WORKER_API_KEY'));
});

test('WORKER_CONCURRENCY outside 1 to 16 or not an integer is refused', () => {
  for (const v of ['0', '17', 'abc', '2.5']) assert.throws(() => make({ env: { ...ENV, WORKER_CONCURRENCY: v } }), configError('WORKER_CONCURRENCY'), v);
});

test('WORKER_DRAIN_MS outside 0 to 60000 is refused', () => {
  for (const v of ['-1', '60001', 'soon']) assert.throws(() => make({ env: { ...ENV, WORKER_DRAIN_MS: v } }), configError('WORKER_DRAIN_MS'), v);
});

test('concurrency defaults to 2 and follows WORKER_CONCURRENCY', async () => {
  for (const [env, want] of [[ENV, 2], [{ ...ENV, WORKER_CONCURRENCY: '4' }, 4]]) {
    const g = gate();
    const t = make({ env: { ...env, WORKER_DRAIN_MS: '50' }, handler: g.handler });
    t.worker.start();
    for (let i = 0; i < 6; i++) t.queue.push({ id: `j${i}` });
    await turns();
    assert.equal(t.worker.getMetrics().inFlight, want);
    g.release();
    await finish(t);
  }
});

test('the handler gets the key from WORKER_API_KEY', async () => {
  let seen = null;
  const t = make({ handler: async (job, ctx) => { seen = ctx.apiKey; } });
  t.worker.start();
  t.queue.push({ id: 'a' });
  await turns();
  assert.equal(seen, KEY);
  await finish(t);
});

test('no live key literal is left in the source', () => {
  const files = [];
  const walk = (d) => { for (const e of fs.readdirSync(d, { withFileTypes: true })) { const f = path.join(d, e.name); if (e.isDirectory()) walk(f); else if (/\.(c|m)?js$/.test(e.name)) files.push(f); } };
  walk(path.join(__dirname, '..', 'src'));
  for (const f of files) assert.ok(!/sk_live_[A-Za-z0-9]/.test(fs.readFileSync(f, 'utf8')), path.basename(f));
});

test('a failed job logs level error, the job id and the error message, and counts as failed', async () => {
  const t = make({ handler: async () => { throw new Error('provider said 502'); } });
  t.worker.start();
  t.queue.push({ id: 'inv-9' });
  await turns();
  const entry = t.logs.find((e) => e && e.level === 'error');
  assert.ok(entry, 'an error entry was logged');
  assert.equal(entry.jobId, 'inv-9');
  assert.match(String(entry.error), /provider said 502/);
  assert.deepEqual([t.worker.getMetrics().failed, t.worker.getMetrics().processed], [1, 0]);
  await finish(t);
});

test('a handler that throws at once is a failure and the worker keeps going', async () => {
  let n = 0;
  const t = make({ handler: (job) => { n++; if (job.id === 'bad') throw new Error('boom'); return Promise.resolve(); } });
  t.worker.start();
  t.queue.push({ id: 'bad' });
  t.queue.push({ id: 'ok1' });
  t.queue.push({ id: 'ok2' });
  await turns(10);
  assert.equal(n, 3);
  assert.deepEqual([t.worker.getMetrics().failed, t.worker.getMetrics().processed], [1, 2]);
  await finish(t);
});

test('no log entry holds the key, on success or on failure', async () => {
  const t = make({ handler: async (job) => { if (job.id === 'x') throw new Error(`rejected for key ${KEY.slice(0, 4)}`); } });
  t.worker.start();
  t.queue.push({ id: 'x' });
  t.queue.push({ id: 'y' });
  await turns(10);
  assert.ok(t.logs.length >= 2, 'both jobs logged');
  assert.ok(!JSON.stringify(t.logs).includes(KEY));
  const done = t.logs.find((e) => e && e.level === 'info');
  assert.equal(done && done.jobId, 'y');
  await finish(t);
});

test('health is ok between start and stop and records the last success time from the clock', async () => {
  const t = make({ now: 1234567 });
  assert.equal(t.worker.health().ok, false, 'not ok before start');
  t.worker.start();
  assert.deepEqual(t.worker.health(), { ok: true, inFlight: 0, lastSuccessAt: null });
  t.queue.push({ id: 'a' });
  await turns();
  assert.equal(t.worker.health().lastSuccessAt, 1234567);
  const stopping = t.worker.stop();
  assert.equal(t.worker.health().ok, false, 'not ok once stop is called');
  await stopping;
  t.queue.close();
});

test('stop waits for jobs in flight, takes no new job and reports drained', async () => {
  let release;
  const t = make({ env: { ...ENV, WORKER_CONCURRENCY: '1', WORKER_DRAIN_MS: '2000' }, handler: () => new Promise((resolve) => { release = resolve; }) });
  t.worker.start();
  t.queue.push({ id: 'first' });
  t.queue.push({ id: 'second' });
  await turns();
  const stopping = t.worker.stop();
  setTimeout(() => release(), 20);
  assert.deepEqual(await stopping, { drained: true });
  assert.equal(t.worker.getMetrics().processed, 1);
  assert.equal(t.queue.size(), 1, 'the job not yet taken stays in the queue');
  t.queue.close();
});

test('stop gives up after WORKER_DRAIN_MS and reports not drained', async () => {
  const t = make({ env: { ...ENV, WORKER_DRAIN_MS: '30' }, handler: () => new Promise(() => {}) });
  t.worker.start();
  t.queue.push({ id: 'stuck' });
  await turns();
  const started = Date.now();
  assert.deepEqual(await t.worker.stop(), { drained: false });
  assert.ok(Date.now() - started < 1500, 'the bound is WORKER_DRAIN_MS, not forever');
  t.queue.close();
  await sleep(1);
});
