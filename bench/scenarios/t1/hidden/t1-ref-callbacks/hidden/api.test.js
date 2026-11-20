'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const fsp = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { runPipeline, processFile, retry, FileStore } = require('../src');

async function setup(names = ['b.txt', 'a.txt']) {
  const root = await fsp.mkdtemp(path.join(os.tmpdir(), 'sieve-hidden-'));
  const input = path.join(root, 'input');
  const output = path.join(root, 'output');
  await fsp.mkdir(input);
  for (const name of names) await fsp.writeFile(path.join(input, name), `content for ${name}`);
  return { root, input, output };
}
async function cleanup(root) { await fsp.rm(root, { recursive: true, force: true }); }
async function until(predicate) {
  for (let attempt = 0; attempt < 1000; attempt += 1) {
    if (predicate()) return;
    await new Promise((resolve) => setImmediate(resolve));
  }
  throw new Error('condition was not reached');
}

 test('runPipeline returns a promise with the documented summary', async () => {
  const env = await setup();
  try {
    const summary = await runPipeline(env.input, env.output, { concurrency: 2 });
    assert.equal(summary.processed, 2);
    assert.deepEqual(summary.files.map((item) => item.source), ['a.txt', 'b.txt']);
    assert.equal(JSON.parse(await fsp.readFile(path.join(env.output, 'a.json'))).source, 'a.txt');
  } finally { await cleanup(env.root); }
});

test('callback mode returns the same operation as a promise and calls back once', async () => {
  const env = await setup(['only.txt']);
  try {
    let calls = 0;
    let callbackSummary;
    const returned = runPipeline(env.input, env.output, {}, (err, summary) => { calls += 1; assert.ifError(err); callbackSummary = summary; });
    assert.equal(typeof returned.then, 'function');
    const result = await returned;
    assert.equal(result.processed, 1);
    await new Promise((resolve) => setImmediate(resolve));
    assert.equal(calls, 1);
    assert.deepEqual(callbackSummary, result);
  } finally { await cleanup(env.root); }
});

test('a failed pipeline rejects and calls its error callback once', async () => {
  const env = await setup();
  await cleanup(env.root);
  let calls = 0;
  const returned = runPipeline(env.input, env.output, {}, (err) => { calls += 1; assert.ok(err); });
  await assert.rejects(returned, /ENOENT/);
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(calls, 1);
});

test('promise callers receive validation failures', async () => {
  const env = await setup();
  try {
    await assert.rejects(runPipeline(env.input, env.output, { concurrency: 0 }), /positive integer/);
  } finally { await cleanup(env.root); }
});

test('retry resolves an error-first operation after the requested attempts', async () => {
  let attempts = 0;
  const value = await retry((done) => { attempts += 1; if (attempts < 3) done(new Error('try again')); else done(null, 42); }, { retries: 2 });
  assert.equal(value, 42);
  assert.equal(attempts, 3);
});

test('retry makes the first attempt plus the requested extra attempts, then reports the last error', async () => {
  let attempts = 0;
  await assert.rejects(retry((done) => { attempts += 1; done(new Error('failure ' + attempts)); }, { retries: 2 }), /failure 3/);
  assert.equal(attempts, 3);
});

test('retry callback errors are single-shot and its promise rejects', async () => {
  let callbackCalls = 0;
  const returned = retry(() => { throw new Error('permanent'); }, { retries: 2 }, (err) => { callbackCalls += 1; assert.equal(err.message, 'permanent'); });
  await assert.rejects(returned, /permanent/);
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(callbackCalls, 1);
});

test('FileStore methods have promise forms and create parent directories', async () => {
  const env = await setup([]);
  try {
    const store = new FileStore();
    const file = path.join(env.output, 'deep', 'record.json');
    await store.writeJson(file, { value: 7 });
    assert.deepEqual(JSON.parse(await store.readText(file)), { value: 7 });
    await store.ensureDir(path.join(env.output, 'another'));
    assert.equal(fs.statSync(path.join(env.output, 'another')).isDirectory(), true);
  } finally { await cleanup(env.root); }
});

test('FileStore callback mode returns a promise and calls back once', async () => {
  const env = await setup([]);
  try {
    const store = new FileStore(); let calls = 0;
    const returned = store.writeJson(path.join(env.output, 'record.json'), { ok: true }, (err) => { calls += 1; assert.ifError(err); });
    assert.equal(typeof returned.then, 'function');
    await returned;
    await new Promise((resolve) => setImmediate(resolve));
    assert.equal(calls, 1);
  } finally { await cleanup(env.root); }
});

test('FileStore reports a read error once in callback mode', async () => {
  const store = new FileStore(); let calls = 0;
  const returned = store.readText('/no/such/sieve-file', (err) => { calls += 1; assert.ok(err); });
  await assert.rejects(returned, /ENOENT/);
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(calls, 1);
});

test('processFile returns the output descriptor as a promise', async () => {
  const env = await setup(['one.txt']);
  try {
    const result = await processFile(path.join(env.input, 'one.txt'), env.output, {});
    assert.deepEqual(result, { source: 'one.txt', output: 'one.json' });
  } finally { await cleanup(env.root); }
});

test('pipeline never exceeds the configured concurrency', async () => {
  const env = await setup(['a.txt', 'b.txt', 'c.txt', 'd.txt']);
  const releases = [];
  let active = 0; let maximum = 0;
  try {
    const running = runPipeline(env.input, env.output, {
      concurrency: 2,
      beforeWrite(name, done) {
        active += 1; maximum = Math.max(maximum, active);
        releases.push(() => { active -= 1; done(null); });
      }
    });
    await until(() => releases.length === 2);
    while (releases.length) releases.shift()();
    await until(() => releases.length === 2);
    while (releases.length) releases.shift()();
    await running;
    assert.equal(maximum, 2);
  } finally { while (releases.length) releases.shift()(); await cleanup(env.root); }
});

test('pipeline keeps its sorted result order when hooks finish out of order', async () => {
  const env = await setup(['c.txt', 'a.txt', 'b.txt']);
  const waiting = new Map();
  try {
    const running = runPipeline(env.input, env.output, { concurrency: 3, beforeWrite(name, done) { waiting.set(name, () => done(null)); } });
    await until(() => waiting.size === 3);
    waiting.get('c.txt')(); waiting.get('b.txt')(); waiting.get('a.txt')();
    const result = await running;
    assert.deepEqual(result.files.map((item) => item.source), ['a.txt', 'b.txt', 'c.txt']);
  } finally { for (const resolve of waiting.values()) resolve(); await cleanup(env.root); }
});

test('an empty input still returns an ordered empty summary', async () => {
  const env = await setup([]);
  try { assert.deepEqual(await runPipeline(env.input, env.output, {}), { processed: 0, files: [] }); }
  finally { await cleanup(env.root); }
});

test('CLI success keeps its exit code and output wording', async () => {
  const env = await setup(['cli.txt']);
  try {
    const result = spawnSync(process.execPath, [path.join(__dirname, '../bin/sieve.js'), '--input', env.input, '--output', env.output], { encoding: 'utf8' });
    assert.equal(result.status, 0);
    assert.match(result.stdout, /^Processed 1 file\(s\) into /);
    assert.equal(result.stderr, '');
  } finally { await cleanup(env.root); }
});

test('CLI usage errors retain exit code 2', () => {
  const result = spawnSync(process.execPath, [path.join(__dirname, '../bin/sieve.js'), '--input'], { encoding: 'utf8' });
  assert.equal(result.status, 2);
  assert.match(result.stderr, /missing value|usage/);
});

test('CLI processing errors exit with code 1 and report on stderr', async () => {
  const env = await setup([]);
  try {
    const result = spawnSync(process.execPath, [path.join(__dirname, '../bin/sieve.js'), '--input', path.join(env.root, 'missing'), '--output', env.output], { encoding: 'utf8' });
    assert.equal(result.status, 1);
    assert.match(result.stderr, /^sieve: /);
    assert.equal(result.stdout, '');
  } finally { await cleanup(env.root); }
});

test('CLI rejects a bad concurrency value as a usage error', () => {
  const result = spawnSync(process.execPath, [path.join(__dirname, '../bin/sieve.js'), '--input', 'in', '--output', 'out', '--concurrency', '0'], { encoding: 'utf8' });
  assert.equal(result.status, 2);
});
