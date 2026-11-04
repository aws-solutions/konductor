// SPDX-License-Identifier: Apache-2.0
'use strict';

// Negative controls in the task validator: no check may pass on an empty workspace, and a solved workspace that loses a
// file the solution provides is reported when no check notices.

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { tmp, write } = require('./helpers.js');
const { evalCheck, ANSWER_KEY } = require('../lib/check-matcher.js');
const controls = require('../../tasks/controls.js');
const { loadTasks, BENCH_DIR } = require('../lib/tasks.js');

const VALIDATE = path.join(__dirname, '..', '..', 'tasks', 'validate-tasks.js');
const NO_QUESTIONS = 'Do not ask me questions; if something is unclear, make a reasonable assumption, list your assumptions in your final message, and finish the work.';
const RUBRIC = [1, 2, 3].map((n) => ({ id: `c${n}`, criterion: `Does thing ${n}.`, weight: 1 }));

function extraDir(root, checks, { solution = { 'out.txt': 'done\n' } } = {}) {
  const dir = path.join(root, 'extra');
  write(path.join(dir, 'fixtures', 'xf', 'a.txt'), 'alpha\n');
  write(path.join(dir, 'fixtures', 'xf', 'README.md'), 'readme\n');
  write(path.join(dir, 'fixtures', 'xf', '.bench-answer-key.md'), 'key\n');
  write(path.join(dir, 'x1.json'), JSON.stringify({
    id: 'x1', class: 'simple', target: null, prompt: `Create out.txt containing done. ${NO_QUESTIONS}`, fixture: 'xf', timeoutSec: 120, checks, rubric: RUBRIC, tiers: ['lite'],
  }));
  for (const [f, text] of Object.entries(solution)) write(path.join(dir, 'solutions', 'x1', f), text);
  return dir;
}

const validate = (root, dir) => {
  fs.mkdirSync(path.join(root, 'h'), { recursive: true });
  return spawnSync(process.execPath, [VALIDATE, '--only-extra', '--extra-tasks', dir], { encoding: 'utf8', env: { PATH: process.env.PATH, HOME: path.join(root, 'h') } });
};

const EXISTS = { type: 'file_exists', path: 'out.txt' };
const VACUOUS = { type: 'cmd', cmd: '! grep -q zzz missing.txt', expectExit: 0 };

test('the validator rejects a check that passes on an empty workspace', () => {
  const root = tmp();
  try {
    const bad = validate(root, extraDir(root, [EXISTS, VACUOUS]));
    assert.equal(bad.status, 1, bad.stdout);
    assert.match(bad.stderr, /x1: checks\[1\] \(cmd\) passes on an empty workspace/);
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});

test('the control: the same task without the vacuous check validates', () => {
  const root = tmp();
  try {
    const ok = validate(root, extraDir(root, [EXISTS]));
    assert.equal(ok.status, 0, ok.stdout + ok.stderr);
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});

test('a node --test check passes on an empty workspace, so it must be written to need tests', () => {
  const root = tmp();
  try {
    const bad = validate(root, extraDir(root, [EXISTS, { type: 'cmd', cmd: 'node --test', expectExit: 0 }]));
    assert.equal(bad.status, 1);
    assert.match(bad.stderr, /checks\[1\] \(cmd\) passes on an empty workspace/);
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});

test('a deletion gap is a warning: removing a file the solution provides leaves every check green', () => {
  const root = tmp();
  try {
    const dir = extraDir(root, [EXISTS], { solution: { 'out.txt': 'done\n', 'NOTES.md': 'notes\n' } });
    const r = validate(root, dir);
    assert.equal(r.status, 0, r.stderr);
    assert.match(r.stdout, /warning: x1: every check still passes with NOTES\.md deleted/);
    assert.doesNotMatch(r.stdout, /with out\.txt deleted/);
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});

test('controls.passingOnEmpty names the checks that pass with nothing in the workspace', () => {
  const evalOne = (dir, c) => evalCheck(dir, c, {}).passed;
  assert.deepEqual(controls.passingOnEmpty({ checks: [EXISTS, VACUOUS] }, evalOne), [1]);
  assert.deepEqual(controls.passingOnEmpty({ checks: [EXISTS] }, evalOne), []);
});

test('every check of every bench task fails on an empty workspace', () => {
  const tasks = [...loadTasks(BENCH_DIR).values()].filter((t) => t.fixture && Array.isArray(t.checks) && t.class !== 'real' && t.class !== 'trigger');
  assert.ok(tasks.length > 30);
  const found = {};
  for (const t of tasks) {
    const hiddenDir = t.hiddenDir ?? null;
    const idx = controls.passingOnEmpty(t, (dir, c) => evalCheck(dir, c, { pristineDir: t.fixtureDir, hiddenDir }).passed);
    if (idx.length) found[t.id] = idx;
  }
  assert.deepEqual(found, {});
});

// ---- tight checks for tasks the review found loose ----

const { runChecks } = require('../lib/checks.js');
const { copyFixture } = require('../lib/sandbox.js');
const { buildCheckEnv } = require('../lib/env.js');

const SOLUTIONS = path.join(BENCH_DIR, 'tasks', 'solutions');

function workspace(taskId, edit = () => {}) {
  const task = loadTasks(BENCH_DIR).get(taskId);
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'tight-'));
  copyFixture(task.fixtureDir, dir);
  fs.cpSync(path.join(SOLUTIONS, taskId), dir, { recursive: true });
  edit(dir);
  return { task, dir };
}

const passes = ({ task, dir }) => {
  const { env } = buildCheckEnv(process.env, { home: path.join(dir, '.home') });
  return runChecks(dir, task.checks, { pristineDir: task.fixtureDir, hiddenDir: task.hiddenDir ?? null, env }).map((c) => c.passed);
};

const sub = (file, from, to) => (dir) => {
  const p = path.join(dir, file);
  const text = fs.readFileSync(p, 'utf8');
  assert.ok(text.includes(from), `${from} is in ${file}`);
  fs.writeFileSync(p, text.replace(from, to));
};

test('simple-rename: deleting README.md, or leaving it unrenamed, fails; the reference solution passes', () => {
  const ok = passes(workspace('simple-rename'));
  assert.deepEqual(ok, [true, true, true]);
  const gone = passes(workspace('simple-rename', (d) => fs.rmSync(path.join(d, 'README.md'))));
  assert.equal(gone[0], false, 'a missing README.md is not a rename');
  const stale = passes(workspace('simple-rename', (d) => fs.appendFileSync(path.join(d, 'README.md'), '\nUse cnt(text) to count.\n')));
  assert.equal(stale[0], false);
  const noTests = passes(workspace('simple-rename', (d) => fs.rmSync(path.join(d, 'test'), { recursive: true })));
  assert.equal(noTests[0], false, 'a missing test directory is not a rename');
});

test('simple-readme-section: an example whose shown output is wrong fails; other output styles pass', () => {
  const task = loadTasks(BENCH_DIR).get('simple-readme-section');
  const outputCheck = task.checks.length - 1;
  assert.ok(passes(workspace('simple-readme-section')).every(Boolean), 'the reference solution passes every check');
  for (const [from, to] of [["// 'hello-world'", "// 'hello_world'"], ["// 'abcde...'", "// 'abcdefgh...'"], ["// ['a,b', 'c']", "// ['a', 'b', 'c']"]]) {
    const r = passes(workspace('simple-readme-section', sub('README.md', from, to)));
    assert.equal(r[outputCheck], false, `${from} -> ${to}`);
    assert.ok(r.slice(0, outputCheck).every(Boolean), 'the pattern checks alone still pass, which is the gap');
  }
  assert.equal(passes(workspace('simple-readme-section', sub('README.md', "slugify('Hello World'); // 'hello-world'", "console.log(slugify('Hello World')); // hello-world")))[outputCheck], true);
  assert.equal(passes(workspace('simple-readme-section', sub('README.md', "// 'hello-world'", "=> \"hello-world\"")))[outputCheck], true);
});

test('hard-invoice-refactor: an empty src tree fails the size check', () => {
  const task = loadTasks(BENCH_DIR).get('hard-invoice-refactor');
  const idx = task.checks.findIndex((c) => c.cmd && c.cmd.includes('-le 120'));
  assert.ok(idx > 0);
  assert.equal(passes(workspace('hard-invoice-refactor'))[idx], true);
  assert.equal(passes(workspace('hard-invoice-refactor', (d) => fs.rmSync(path.join(d, 'src'), { recursive: true })))[idx], false);
});
