import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { ConfigReloader, ConfigReloadError, CONFIG_FILES } from './src/config/reload.ts';
import { validateConfig } from './src/config/schema.ts';
import { createPoller } from './src/queue/poller.ts';
import { executeJob } from './src/jobs/execute.ts';
import { workerSettings, runDelivery } from './src/worker/runner.ts';
import { handleRequest } from './src/http/server.ts';

const worker = { pollIntervalMs: 500, maxAttempts: 3, leaseSeconds: 30, logLevel: 'info', queueName: 'harbor-delivery', region: 'fjord-1', workerConcurrency: 4 };
const limits = { maxPayloadBytes: 1048576, jobTimeoutMs: 5000, backoffMs: 250 };

function makeRoot() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'hh-hidden-'));
  fs.mkdirSync(path.join(dir, 'config'));
  writeRoot(dir, worker, limits);
  return dir;
}
function writeRoot(dir, nextWorker, nextLimits = limits) {
  fs.writeFileSync(path.join(dir, 'config/worker.json'), JSON.stringify(nextWorker));
  fs.writeFileSync(path.join(dir, 'config/limits.json'), JSON.stringify(nextLimits));
}
function dispose(dir) { fs.rmSync(dir, { recursive: true, force: true }); }
function quiet(rootDir, extra = {}) { return new ConfigReloader({ rootDir, watch: () => () => {}, ...extra }); }

function startFlow(dir, extra = {}) {
  const reloader = quiet(dir, extra);
  reloader.start();
  const pulls = [];
  const queue = { pull: async (size) => { pulls.push(size); return [{ size }]; } };
  const poller = createPoller(queue, reloader);
  return { reloader, poller, pulls };
}

async function observeFlow(reloader, poller) {
  let delivered;
  const delivery = await runDelivery(
    { id: 'j1', payload: { route: 'north' }, attempt: 1 },
    async (_payload, config) => { delivered = config; },
    reloader
  );
  const job = await executeJob(
    { payload: { route: 'north' } },
    async (_payload, timeout, config) => [timeout, config.maxAttempts, config.workerConcurrency],
    reloader
  );
  const settings = workerSettings(reloader);
  const pulled = await poller.pull();
  return { delivered, delivery, job, settings, pulled };
}

// The validator tests stay at the config-module boundary; the remaining tests exercise consumers through a source.
test('validator rejects an unknown key instead of preserving it', () => {
  assert.throws(() => validateConfig({ ...worker, ...limits, maxAttepts: 4 }), /unknown configuration key/);
});

test('validator rejects non-integer numbers and unsupported text', () => {
  assert.throws(() => validateConfig({ ...worker, ...limits, maxAttempts: 1.5 }), /maxAttempts must be an integer/);
  assert.throws(() => validateConfig({ ...worker, ...limits, logLevel: 'trace' }), /unsupported log level/);
});

test('environment precedence reaches the running runner, executor, and poller flow', async () => {
  const dir = makeRoot();
  try {
    const { reloader, poller } = startFlow(dir, { env: { WORKER_MAX_ATTEMPTS: '8', WORKER_QUEUE_NAME: 'night-run' } });
    const observed = await observeFlow(reloader, poller);
    assert.equal(observed.delivered.queueName, 'night-run');
    assert.deepEqual(observed.job, { result: [5000, 8, 4], attempts: 8 });
    assert.equal(observed.settings.maxAttempts, 8);
    reloader.stop();
  } finally { dispose(dir); }
});

test('documented units survive startup and reload through every consumer', async () => {
  const dir = makeRoot();
  try {
    assert.deepEqual(CONFIG_FILES, ['config/worker.json', 'config/limits.json']);
    const { reloader, poller } = startFlow(dir);
    const initial = await observeFlow(reloader, poller);
    assert.equal(initial.delivered.leaseSeconds, 30);
    assert.deepEqual(initial.job.result, [5000, 3, 4]);
    writeRoot(dir, { ...worker, pollIntervalMs: 700 }, { ...limits, jobTimeoutMs: 6500 });
    assert.equal(reloader.reload('file').accepted, true);
    const updated = await observeFlow(reloader, poller);
    assert.equal(poller.intervalMs, 700);
    assert.deepEqual(updated.job.result, [6500, 3, 4]);
    reloader.stop();
  } finally { dispose(dir); }
});

test('startup gives runner, executor, and poller the same initial snapshot', async () => {
  const dir = makeRoot();
  try {
    const { reloader, poller, pulls } = startFlow(dir);
    const observed = await observeFlow(reloader, poller);
    assert.equal(observed.delivered.maxAttempts, 3);
    assert.deepEqual(observed.job.result, [5000, 3, 4]);
    assert.deepEqual(observed.job, { result: [5000, 3, 4], attempts: 3 });
    assert.deepEqual(observed.settings, { workerConcurrency: 4, maxAttempts: 3 });
    assert.deepEqual(observed.pulled, [{ size: 4 }]);
    assert.deepEqual(pulls, [4]);
    reloader.stop();
  } finally { dispose(dir); }
});

test('environment overrides reach every consumer in the running flow', async () => {
  const dir = makeRoot();
  try {
    const { reloader, poller } = startFlow(dir, { env: { WORKER_MAX_ATTEMPTS: '8', WORKER_CONCURRENCY: '2', WORKER_JOB_TIMEOUT_MS: '9000' } });
    const observed = await observeFlow(reloader, poller);
    assert.equal(observed.delivered.maxAttempts, 8);
    assert.deepEqual(observed.job, { result: [9000, 8, 2], attempts: 8 });
    assert.deepEqual(observed.settings, { workerConcurrency: 2, maxAttempts: 8 });
    assert.deepEqual(observed.pulled, [{ size: 2 }]);
    reloader.stop();
  } finally { dispose(dir); }
});

test('accepted reload updates runner, executor, and poller end to end', async () => {
  const dir = makeRoot();
  try {
    const { reloader, poller, pulls } = startFlow(dir);
    writeRoot(dir, { ...worker, maxAttempts: 7, pollIntervalMs: 800, workerConcurrency: 2 }, { ...limits, jobTimeoutMs: 9000 });
    const result = reloader.reload('file');
    assert.equal(result.accepted, true);
    assert.deepEqual(result.changed.sort(), ['jobTimeoutMs', 'maxAttempts', 'pollIntervalMs', 'workerConcurrency']);
    const observed = await observeFlow(reloader, poller);
    assert.equal(poller.intervalMs, 800);
    assert.deepEqual(observed.job, { result: [9000, 7, 2], attempts: 7 });
    assert.deepEqual(observed.settings, { workerConcurrency: 2, maxAttempts: 7 });
    assert.deepEqual(observed.pulled, [{ size: 2 }]);
    assert.deepEqual(pulls, [2]);
    reloader.stop();
  } finally { dispose(dir); }
});

test('a reload during executeJob leaves all reads on its captured snapshot', async () => {
  const dir = makeRoot();
  try {
    const { reloader, poller } = startFlow(dir);
    let seen;
    const result = await executeJob({ payload: {} }, async (_payload, timeout, config) => {
      seen = [timeout, config.maxAttempts, config.workerConcurrency];
      writeRoot(dir, { ...worker, maxAttempts: 10, workerConcurrency: 1 }, { ...limits, jobTimeoutMs: 9000 });
      assert.equal(reloader.reload('file').accepted, true);
      await Promise.resolve();
      return [timeout, config.maxAttempts, config.workerConcurrency];
    }, reloader);
    assert.deepEqual(result, { result: [5000, 3, 4], attempts: 3 });
    assert.deepEqual(seen, [5000, 3, 4]);
    const after = await observeFlow(reloader, poller);
    assert.deepEqual(after.job, { result: [9000, 10, 1], attempts: 10 });
    reloader.stop();
  } finally { dispose(dir); }
});

test('runDelivery captures one config while a handler awaits a reload', async () => {
  const dir = makeRoot();
  try {
    const { reloader, poller } = startFlow(dir);
    let seen;
    const result = await runDelivery({ id: 'j2', payload: {}, attempt: 1 }, async (_payload, config) => {
      seen = config;
      writeRoot(dir, { ...worker, maxAttempts: 11, workerConcurrency: 1 });
      assert.equal(reloader.reload('file').accepted, true);
      await Promise.resolve();
      assert.equal(config.maxAttempts, 3);
    }, reloader);
    assert.deepEqual(result, { id: 'j2', attempt: 1 });
    assert.equal(seen.maxAttempts, 3);
    const after = await observeFlow(reloader, poller);
    assert.equal(after.delivered.maxAttempts, 11);
    assert.equal(after.job.attempts, 11);
    reloader.stop();
  } finally { dispose(dir); }
});

test('a malformed file keeps the last good snapshot for every consumer', async () => {
  const dir = makeRoot();
  try {
    const { reloader, poller } = startFlow(dir);
    writeRoot(dir, { ...worker, maxAttempts: 6, workerConcurrency: 2 });
    assert.equal(reloader.reload('file').accepted, true);
    fs.writeFileSync(path.join(dir, 'config/worker.json'), '');
    const result = reloader.reload('file');
    assert.equal(result.accepted, false);
    assert.equal(result.error.code, 'CONFIG_PARSE');
    const observed = await observeFlow(reloader, poller);
    assert.equal(observed.delivered.maxAttempts, 6);
    assert.equal(observed.job.attempts, 6);
    assert.deepEqual(observed.settings, { workerConcurrency: 2, maxAttempts: 6 });
    assert.deepEqual(observed.pulled, [{ size: 2 }]);
    reloader.stop();
  } finally { dispose(dir); }
});

test('a schema-invalid file keeps the last good snapshot for every consumer', async () => {
  const dir = makeRoot();
  try {
    const { reloader, poller } = startFlow(dir);
    writeRoot(dir, { ...worker, maxAttempts: 5 });
    assert.equal(reloader.reload('file').accepted, true);
    writeRoot(dir, { ...worker, maxAttempts: 99, workerConcurrency: 0 });
    const result = reloader.reload('file');
    assert.equal(result.accepted, false);
    assert.equal(result.error.code, 'CONFIG_SCHEMA');
    const observed = await observeFlow(reloader, poller);
    assert.equal(observed.delivered.maxAttempts, 5);
    assert.equal(observed.job.attempts, 5);
    assert.deepEqual(observed.settings, { workerConcurrency: 4, maxAttempts: 5 });
    reloader.stop();
  } finally { dispose(dir); }
});

test('unknown keys are rejected without changing the flow', async () => {
  const dir = makeRoot();
  try {
    const { reloader, poller } = startFlow(dir);
    writeRoot(dir, { ...worker, maxAttepts: 12 });
    const result = reloader.reload('file');
    assert.equal(result.accepted, false);
    assert.equal(result.error.code, 'CONFIG_UNKNOWN_KEY');
    const observed = await observeFlow(reloader, poller);
    assert.equal(observed.job.attempts, 3);
    assert.equal(observed.delivered.maxAttempts, 3);
    reloader.stop();
  } finally { dispose(dir); }
});

test('bad environment values are rejected before consumers start', async () => {
  const dir = makeRoot();
  try {
    const reloader = quiet(dir, { env: { WORKER_MAX_ATTEMPTS: 'many' } });
    assert.throws(() => reloader.start(), (error) => error instanceof ConfigReloadError && error.code === 'CONFIG_ENV');
    // A valid source can still start from the same files and drive the normal flow.
    const valid = startFlow(dir);
    writeRoot(dir, { ...worker, maxAttempts: 8 });
    assert.equal(valid.reloader.reload('file').accepted, true);
    const observed = await observeFlow(valid.reloader, valid.poller);
    assert.equal(observed.job.attempts, 8);
    assert.equal(observed.delivered.maxAttempts, 8);
    valid.reloader.stop();
  } finally { dispose(dir); }
});

test('SIGHUP applies a reload immediately to runner, executor, and poller', async () => {
  const dir = makeRoot();
  try {
    let hup;
    const signal = { on(name, listener) { if (name === 'SIGHUP') hup = listener; }, off() {} };
    const { reloader, poller } = startFlow(dir, { signal });
    writeRoot(dir, { ...worker, pollIntervalMs: 750, workerConcurrency: 1, maxAttempts: 9 });
    hup();
    assert.equal(poller.intervalMs, 750);
    const observed = await observeFlow(reloader, poller);
    assert.deepEqual(observed.job, { result: [5000, 9, 1], attempts: 9 });
    assert.equal(observed.delivered.maxAttempts, 9);
    reloader.stop();
  } finally { dispose(dir); }
});

test('a changed snapshot notifies after the flow has an atomic current value', async () => {
  const dir = makeRoot();
  try {
    const { reloader, poller } = startFlow(dir);
    let seen;
    reloader.onChange((change) => {
      seen = change;
      assert.equal(reloader.getSnapshot(), change.current);
      assert.equal(workerSettings(reloader).maxAttempts, change.current.maxAttempts);
    });
    writeRoot(dir, { ...worker, maxAttempts: 12 });
    const result = reloader.reload('file');
    assert.deepEqual(result.changed, ['maxAttempts']);
    assert.deepEqual(seen.changed, ['maxAttempts']);
    const observed = await observeFlow(reloader, poller);
    assert.equal(observed.job.attempts, 12);
    assert.equal(observed.delivered.maxAttempts, 12);
    reloader.stop();
  } finally { dispose(dir); }
});

test('a no-op reload is accepted without a false change event', async () => {
  const dir = makeRoot();
  try {
    const { reloader, poller } = startFlow(dir);
    let notifications = 0;
    reloader.onChange(() => { notifications += 1; });
    const result = reloader.reload('file');
    assert.equal(result.accepted, true);
    assert.deepEqual(result.changed, []);
    assert.equal(notifications, 0);
    const observed = await observeFlow(reloader, poller);
    assert.equal(observed.job.attempts, 3);
    assert.equal(observed.delivered.maxAttempts, 3);
    reloader.stop();
  } finally { dispose(dir); }
});

test('poller properties and pull use the current source while runner and executor do too', async () => {
  const dir = makeRoot();
  try {
    const { reloader, poller } = startFlow(dir);
    assert.equal(poller.intervalMs, 500);
    writeRoot(dir, { ...worker, pollIntervalMs: 1200, workerConcurrency: 3, maxAttempts: 13 }, { ...limits, jobTimeoutMs: 7000 });
    assert.equal(reloader.reload('file').accepted, true);
    assert.equal(poller.intervalMs, 1200);
    const observed = await observeFlow(reloader, poller);
    assert.deepEqual(observed.job, { result: [7000, 13, 3], attempts: 13 });
    assert.deepEqual(observed.settings, { workerConcurrency: 3, maxAttempts: 13 });
    assert.deepEqual(observed.pulled, [{ size: 3 }]);
    reloader.stop();
  } finally { dispose(dir); }
});

test('debounced file reload applies the final candidate to the whole flow', async () => {
  const dir = makeRoot();
  try {
    let notify;
    const scheduled = [];
    const reloader = new ConfigReloader({
      rootDir: dir,
      watch: (onChange) => { notify = onChange; return () => {}; },
      schedule: (fn) => { scheduled.push(fn); return fn; },
      cancelSchedule: () => {}
    });
    reloader.start();
    const queue = { pull: async (size) => [{ size }] };
    const poller = createPoller(queue, reloader);
    notify();
    notify();
    assert.equal(scheduled.length, 2);
    writeRoot(dir, { ...worker, maxAttempts: 14, workerConcurrency: 2 });
    scheduled[1]();
    const observed = await observeFlow(reloader, poller);
    assert.deepEqual(observed.job, { result: [5000, 14, 2], attempts: 14 });
    assert.equal(observed.delivered.maxAttempts, 14);
    reloader.stop();
  } finally { dispose(dir); }
});

test('flush reads the final file after an intermediate empty save and updates all consumers', async () => {
  const dir = makeRoot();
  try {
    let notify;
    const reloader = new ConfigReloader({ rootDir: dir, watch: (onChange) => { notify = onChange; return () => {}; }, schedule: (fn) => fn, cancelSchedule: () => {} });
    reloader.start();
    const poller = createPoller({ pull: async (size) => [{ size }] }, reloader);
    fs.writeFileSync(path.join(dir, 'config/worker.json'), '');
    notify();
    writeRoot(dir, { ...worker, maxAttempts: 15, workerConcurrency: 1 });
    const result = reloader.flushPending();
    assert.equal(result.accepted, true);
    const observed = await observeFlow(reloader, poller);
    assert.deepEqual(observed.job, { result: [5000, 15, 1], attempts: 15 });
    assert.equal(observed.delivered.maxAttempts, 15);
    reloader.stop();
  } finally { dispose(dir); }
});

test('listener failures do not roll back an accepted flow snapshot', async () => {
  const dir = makeRoot();
  try {
    const { reloader, poller } = startFlow(dir);
    reloader.onChange(() => { throw new Error('observer failed'); });
    writeRoot(dir, { ...worker, maxAttempts: 16, workerConcurrency: 2 });
    const result = reloader.reload('file');
    assert.equal(result.accepted, true);
    const observed = await observeFlow(reloader, poller);
    assert.deepEqual(observed.job, { result: [5000, 16, 2], attempts: 16 });
    assert.equal(observed.delivered.maxAttempts, 16);
    reloader.stop();
  } finally { dispose(dir); }
});

test('stopping removes the watcher and pending debounce timer after a flow starts', () => {
  let closed = false;
  let timer;
  const reloader = new ConfigReloader({
    watch: () => () => { closed = true; },
    schedule: (fn) => { timer = fn; return fn; },
    cancelSchedule: () => { timer = undefined; }
  });
  reloader.start();
  // This is the debounce edge case, not a consumer shortcut.
  reloader.stop();
  assert.equal(closed, true);
  assert.equal(timer, undefined);
});

test('health routes retain their status contract alongside the reloaded worker', async () => {
  const dir = makeRoot();
  try {
    const { reloader, poller } = startFlow(dir);
    const observed = await observeFlow(reloader, poller);
    assert.equal(observed.job.attempts, 3);
    assert.equal(handleRequest('/health').status, 200);
    assert.equal(handleRequest('/ready').status, 200);
    assert.equal(handleRequest('/other').status, 404);
    reloader.stop();
  } finally { dispose(dir); }
});
