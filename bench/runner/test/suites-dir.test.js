// SPDX-License-Identifier: Apache-2.0
'use strict';

// --suites-dir DIR: a suite file is looked up in DIR first and then in <bench-dir>/suites. In-process only, no runner spawn.

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { tmp, write, makeBench } = require('./helpers.js');
const { isSuiteName, loadSuite, loadTasks, suiteExtraDirs, suiteFile, suiteDirs } = require('../lib/tasks.js');
const { cmdRun } = require('../lib/run-cmd.js');
const { FLAGS } = require('../lib/cli-flags.js');

const NAME = 'skilleval-import-demo';

function setup() {
  const root = tmp();
  const bench = makeBench(path.join(root, 'bench'));
  const scratch = path.join(root, 'scratch');
  fs.mkdirSync(path.join(bench, 'suites'), { recursive: true });
  fs.mkdirSync(scratch);
  return { root, bench, scratch };
}

test('a skilleval suite is found in --suites-dir and not found without it', () => {
  const { root, bench, scratch } = setup();
  try {
    write(path.join(scratch, `${NAME}.json`), JSON.stringify({ tasks: ['t1'], arms: ['vanilla', 'main'] }));
    assert.equal(isSuiteName(NAME, bench), false);
    assert.equal(isSuiteName(NAME, bench, scratch), true);
    assert.equal(suiteFile(NAME, bench, scratch), path.join(scratch, `${NAME}.json`));
    const s = loadSuite(NAME, loadTasks(bench), bench, scratch);
    assert.deepEqual(s.taskIds, ['t1']);
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});

test('the suites directory wins over <bench-dir>/suites; the bench directory is the fallback', () => {
  const { root, bench, scratch } = setup();
  try {
    write(path.join(bench, 'suites', `${NAME}.json`), JSON.stringify({ tasks: ['from-bench'] }));
    assert.deepEqual(suiteDirs(bench, scratch), [scratch, path.join(bench, 'suites')]);
    assert.equal(suiteFile(NAME, bench, scratch), path.join(bench, 'suites', `${NAME}.json`));
    write(path.join(scratch, `${NAME}.json`), JSON.stringify({ tasks: ['from-scratch'] }));
    assert.equal(suiteFile(NAME, bench, scratch), path.join(scratch, `${NAME}.json`));
    assert.deepEqual(loadSuite(NAME, new Map(), bench, scratch).taskIds, ['from-scratch']);
    assert.deepEqual(loadSuite(NAME, new Map(), bench).taskIds, ['from-bench']);
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});

test('extraTasks of a suite found in --suites-dir resolve against the bench directory', () => {
  const { root, bench, scratch } = setup();
  try {
    write(path.join(scratch, `${NAME}.json`), JSON.stringify({ extraTasks: ['extra'] }));
    assert.deepEqual(suiteExtraDirs(NAME, bench, scratch), [path.join(bench, 'extra')]);
    assert.deepEqual(suiteExtraDirs(NAME, bench), []);
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});

test('a built-in suite name still works without any suite file, with or without --suites-dir', () => {
  const { root, bench, scratch } = setup();
  try {
    assert.equal(isSuiteName('lite', bench), true);
    assert.equal(isSuiteName('lite', bench, scratch), true);
    assert.deepEqual(loadSuite('lite', loadTasks(bench), bench, scratch).taskIds, ['t1']);
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});

test('an unknown suite is an error that names the directories searched', async () => {
  const { root, bench, scratch } = setup();
  try {
    await assert.rejects(cmdRun({ suite: NAME, 'bench-dir': bench, 'suites-dir': scratch }), (e) => {
      assert.match(e.message, /no suite "skilleval-import-demo"/);
      assert.ok(e.message.includes(scratch) && e.message.includes(path.join(bench, 'suites')), e.message);
      return true;
    });
    await assert.rejects(cmdRun({ suite: NAME, 'bench-dir': bench }), (e) => {
      assert.ok(e.message.includes(path.join(bench, 'suites')) && !e.message.includes(scratch), e.message);
      return true;
    });
    assert.throws(() => loadSuite('nope', new Map(), bench, scratch), /unknown suite "nope".*skilleval-\*/);
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});

test('a --suites-dir that does not exist or has no value is an error before anything runs', async () => {
  const { root, bench } = setup();
  try {
    await assert.rejects(cmdRun({ suite: 'lite', 'bench-dir': bench, 'suites-dir': path.join(root, 'missing') }), /--suites-dir directory not found/);
    await assert.rejects(cmdRun({ suite: 'lite', 'bench-dir': bench, 'suites-dir': true }), /--suites-dir directory not found/);
    await assert.rejects(cmdRun({ suite: 'lite', 'bench-dir': bench, 'suites-dir': path.join(bench, 'tasks', 't1.json') }), /--suites-dir directory not found/);
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});

test('only run accepts --suites-dir', () => {
  assert.ok(FLAGS.run.includes('suites-dir'));
  for (const [cmd, flags] of Object.entries(FLAGS)) if (cmd !== 'run') assert.equal(flags.includes('suites-dir'), false, cmd);
});
