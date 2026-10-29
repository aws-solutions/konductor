// SPDX-License-Identifier: Apache-2.0
'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const reallib = require('../../real/lib.js');
const { makeRealBench, tmp, write, RUBRIC } = require('./real-helpers.js');
const { loadTasks, loadSuite, benchMask } = require('../lib/tasks.js');
const real = require('../lib/real.js');
const { validate, loadSchema } = require('../lib/schema.js');

test('the task schema accepts class real, tier real and a real reference without a fixture', () => {
  const schema = loadSchema('task');
  const task = {
    id: 'real-x', class: 'real', target: null, prompt: 'p', real: 'x', hidden: 'x', timeoutSec: 900, tiers: ['real'],
    checks: [{ type: 'tests', manifest: true }], rubric: RUBRIC,
  };
  assert.deepEqual(validate(schema, task), []);
  assert.match(validate(schema, { ...task, class: 'bogus' }).join(), /class/);
  assert.match(validate(schema, { ...task, tiers: ['nope'] }).join(), /tiers/);
  assert.match(validate(schema, { ...task, real: 3 }).join(), /real/);
});

test('loadTasks loads a real task with a lazy fixtureDir that is not part of the task data', () => {
  const b = makeRealBench();
  try {
    const task = loadTasks(b.bench).get(`real-${b.id}`);
    assert.equal(task.real, b.id);
    assert.equal(Object.keys(task).includes('fixtureDir'), false);
    assert.equal(JSON.stringify(task).includes('fixtureDir'), false);
    assert.equal(task.realEntry.id, b.id);
  } finally { b.done(); }
});

test('a real task naming a missing manifest entry is rejected at load time', () => {
  const b = makeRealBench();
  try {
    const file = path.join(b.bench, `tasks/real-${b.id}.json`);
    write(file, JSON.stringify({ ...JSON.parse(fs.readFileSync(file, 'utf8')), real: 'nope' }));
    assert.throws(() => loadTasks(b.bench), /no manifest entry "nope"/);
  } finally { b.done(); }
});

test('fixtureDir materializes the base tree once, without .git, and checks its hash', () => {
  const b = makeRealBench();
  const prev = process.env.BENCH_REAL_CACHE;
  process.env.BENCH_REAL_CACHE = b.cache;
  try {
    const task = loadTasks(b.bench).get(`real-${b.id}`);
    const dir = task.fixtureDir;
    assert.equal(dir.startsWith(b.cache), true);
    assert.equal(fs.existsSync(path.join(dir, '.git')), false);
    assert.equal(reallib.hashTree(dir).sha256, b.entry.contentSha256);
    assert.equal(task.fixtureDir, dir);
    assert.equal(fs.existsSync(path.join(dir, 'tests/test_add.py')), false, 'the PR test file is not in the base tree');
  } finally {
    if (prev === undefined) delete process.env.BENCH_REAL_CACHE; else process.env.BENCH_REAL_CACHE = prev;
    b.done();
  }
});

test('a missing cache fails fast and names the fetch command', () => {
  const b = makeRealBench({ fetched: false });
  try {
    const task = loadTasks(b.bench).get(`real-${b.id}`);
    assert.throws(() => real.preflight([task], { cache: b.cache }), (e) => /node bench\/real\/fetch\.js/.test(e.message) && e.message.includes(b.id) && e.message.includes(b.cache));
    assert.throws(() => real.materializeInto(task, path.join(tmp(), 'w'), { cache: b.cache }), /node bench\/real\/fetch\.js/);
  } finally { b.done(); }
});

test('materializeInto copies the cached checkout: hash matches the pin, symlink and mode survive, no network is used', () => {
  const b = makeRealBench();
  try {
    const task = loadTasks(b.bench).get(`real-${b.id}`);
    const dest = path.join(tmp(), 'work');
    const m = real.materializeInto(task, dest, { cache: b.cache });
    assert.equal(m.contentSha256, b.entry.contentSha256);
    assert.equal(fs.readlinkSync(path.join(dest, 'link.py')), 'pkg/mod.py');
    assert.ok(fs.statSync(path.join(dest, 'run.sh')).mode & 0o111);
    assert.equal(fs.existsSync(path.join(dest, '.git')), false);
    assert.equal(fs.readFileSync(path.join(dest, 'pkg/mod.py'), 'utf8').includes('a - b'), true, 'the base tree has the bug');
  } finally { b.done(); }
});

test('a manifest hash that no longer matches the cached tree stops the run before the agent starts', () => {
  const b = makeRealBench();
  try {
    const file = path.join(b.bench, 'real/manifest.json');
    const m = JSON.parse(fs.readFileSync(file, 'utf8'));
    m.tasks[0].contentSha256 = '0'.repeat(64);
    write(file, JSON.stringify(m));
    const task = loadTasks(b.bench).get(`real-${b.id}`);
    assert.throws(() => real.materializeInto(task, path.join(tmp(), 'w'), { cache: b.cache }), /content hash/);
  } finally { b.done(); }
});

test('preflight returns the pins and the hash of each materialized tree for run-config', () => {
  const b = makeRealBench();
  try {
    const task = loadTasks(b.bench).get(`real-${b.id}`);
    const rec = real.preflight([task], { cache: b.cache });
    assert.deepEqual(rec, {
      [b.id]: { repo: 'example/demo', baseSha: b.entry.baseSha, contentSha256: b.entry.contentSha256, fileCount: b.entry.fileCount, failToPass: 1, passToPass: 1 },
    });
  } finally { b.done(); }
});

test('the real suite exists with its own defaults and the bench mask hides the real directory', () => {
  const b = makeRealBench();
  try {
    const tasks = loadTasks(b.bench);
    const suite = loadSuite('real', tasks, b.bench);
    assert.deepEqual(suite.taskIds, [`real-${b.id}`]);
    assert.deepEqual(suite.arms, ['vanilla']);
    assert.ok(benchMask(b.bench).includes(path.join(b.bench, 'real')));
    fs.rmSync(path.join(b.bench, 'suites/real.json'));
    const d = loadSuite('real', tasks, b.bench);
    assert.deepEqual(d.arms, ['vanilla', 'v1.2.0', 'main']);
    assert.equal(d.replicates, 1);
    assert.deepEqual(d.taskIds, [`real-${b.id}`]);
  } finally { b.done(); }
});

test('a task revision for a real task comes from the manifest pin, so reports need no cache', () => {
  const { taskRevision } = require('../../judge/revision.js');
  const b = makeRealBench({ fetched: false });
  try {
    const task = loadTasks(b.bench).get(`real-${b.id}`);
    const rev = taskRevision(task);
    assert.match(rev, /^[0-9a-f]{12}$/);
    const changed = { ...task, prompt: `${task.prompt} More.` };
    Object.defineProperty(changed, 'realEntry', { value: task.realEntry });
    assert.notEqual(taskRevision(changed), rev);
  } finally { b.done(); }
});

test('bench.js run --suite real stops before building anything when the cache is empty', async () => {
  const { cmdRun } = require('../lib/run-cmd.js');
  const b = makeRealBench({ fetched: false });
  const out = tmp('rt-out-');
  try {
    await assert.rejects(
      cmdRun({ suite: 'real', 'bench-dir': b.bench, 'real-cache': b.cache, arms: 'vanilla', 'budget-credits': '5', out, isolate: 'none', cache: path.join(out, 'c') }),
      (e) => /node bench\/real\/fetch\.js/.test(e.message) && e.message.includes(b.id),
    );
    assert.equal(fs.existsSync(path.join(out, 'run-config.json')), false, 'nothing was written');
  } finally { b.done(); fs.rmSync(out, { recursive: true, force: true }); }
});
