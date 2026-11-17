// SPDX-License-Identifier: Apache-2.0
'use strict';

// The runner's own files are read or hashed when a command starts: a checkout that moves under a study fails fast.

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { tmp, makeBench } = require('./helpers.js');
const { snapshotTaskInputs } = require('../lib/task-inputs.js');
const { loadSchema, preloadSchemas } = require('../lib/schema.js');
const { loadTasks } = require('../lib/tasks.js');
const { executeRun } = require('../lib/run-one.js');
const { makeFakeKiro } = require('./fake-kiro.js');

test('preloadSchemas reads every schema once, and later loads come from memory', () => {
  const names = preloadSchemas();
  for (const n of ['result', 'task']) assert.ok(names.includes(n), n);
  assert.equal(loadSchema('result'), loadSchema('result'));
  assert.throws(() => preloadSchemas(['result', 'no-such-schema']), /bench file missing: .*no-such-schema\.schema\.json/);
});

test('a task whose fixture changed after the command started is refused before anything is copied', () => {
  const root = tmp();
  try {
    const bench = makeBench(path.join(root, 'bench'));
    const task = loadTasks(bench).get('t1');
    const snap = snapshotTaskInputs([task]);
    snap.check(task);
    assert.match(snap.hashes().t1.fixture, /^[0-9a-f]{64}$/);
    fs.writeFileSync(path.join(bench, 'fixtures/fx/a.txt'), 'switched branch\n');
    assert.throws(() => snap.check(task), /bench files of task t1 changed since this command started \(fixture .*fixtures\/fx\)/);
    snap.check({ id: 'other', fixtureDir: path.join(bench, 'fixtures/fx') });
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});

test('executeRun records the changed fixture as a setup error and never starts the agent', async () => {
  const root = tmp();
  try {
    const bench = makeBench(path.join(root, 'bench'));
    const task = loadTasks(bench).get('t1');
    const bin = path.join(root, 'bin');
    const probe = path.join(root, 'probe');
    fs.mkdirSync(probe);
    makeFakeKiro(bin, { dir: probe });
    const scratchDir = path.join(root, 'scratch');
    fs.mkdirSync(scratchDir);
    const watch = path.join(root, 'watch');
    fs.mkdirSync(watch);
    const authDb = path.join(root, 'data.sqlite3');
    fs.writeFileSync(authDb, 'fake-auth');
    const ctx = {
      taskInputs: snapshotTaskInputs([task]),
      config: { model: 'claude-sonnet-5.5', effort: 'high', agentEngine: 'v2' }, scratchDir, authDb, envKeep: [], envInfo: { kiroCliVersion: 'fake', modelListSnapshotPath: null },
      isolation: { mode: 'none' }, tripwire: { roots: [{ dir: watch, depth: 2 }], extraExcludes: [], absExclude: [scratchDir, path.join(root, 'out')] },
    };
    fs.writeFileSync(path.join(bench, 'fixtures/fx/b.txt'), 'other\n');
    const arm = { id: 'vanilla', label: 'vanilla', ref: null, commitSha: null, harness: 'none', agent: null, vanilla: true };
    const prev = process.env.PATH;
    process.env.PATH = `${bin}${path.delimiter}${prev}`;
    let r;
    try { r = await executeRun({ arm, task, replicate: 1, ctx, prepared: null, outDir: path.join(root, 'out', 't1') }); } finally { process.env.PATH = prev; }
    assert.equal(r.status, 'error');
    assert.match(r.infraError, /changed since this command started/);
    assert.equal(fs.existsSync(path.join(probe, 'started.json')), false, 'the agent never started');
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});
