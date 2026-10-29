// SPDX-License-Identifier: Apache-2.0
'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const probe = require('../../real/probe.js');

const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'probe-test-'));
const write = (f, t) => { fs.mkdirSync(path.dirname(f), { recursive: true }); fs.writeFileSync(f, t); };

function runPy(root, hookDir, modules, extraPath) {
  const p = probe.prepare(hookDir, { runner: 'pytest', modules, existing: extraPath ? { PYTHONPATH: extraPath } : {} });
  const r = spawnSync('python3', ['-c', 'import mylib'], { cwd: root, env: { ...process.env, ...p.env }, encoding: 'utf8' });
  assert.equal(r.status, 0, r.stderr);
  return probe.evaluate(p.out, { runner: 'pytest', modules, root });
}

test('python: a module imported from the task tree is accepted', () => {
  const root = tmp(); const hook = tmp();
  try {
    write(path.join(root, 'mylib/__init__.py'), 'X = 1\n');
    const r = runPy(root, hook, ['mylib']);
    assert.equal(r.ok, true, r.problems.join('; '));
    assert.deepEqual(r.seen, ['mylib=mylib/__init__.py']);
  } finally { fs.rmSync(root, { recursive: true, force: true }); fs.rmSync(hook, { recursive: true, force: true }); }
});

test('python: a module resolved from a host directory is reported', () => {
  const root = tmp(); const hook = tmp(); const host = tmp();
  try {
    write(path.join(host, 'mylib/__init__.py'), 'X = 2\n');
    const r = runPy(root, hook, ['mylib'], host);
    assert.equal(r.ok, false);
    assert.match(r.problems[0], /mylib was loaded from .*outside the task tree/);
  } finally { for (const d of [root, hook, host]) fs.rmSync(d, { recursive: true, force: true }); }
});

test('python: a module that is never imported leaves the location unproven', () => {
  const root = tmp(); const hook = tmp();
  try {
    write(path.join(root, 'mylib/__init__.py'), '');
    const r = runPy(root, hook, ['mylib', 'other']);
    assert.equal(r.ok, false);
    assert.match(r.problems.join(), /module other was never imported/);
  } finally { fs.rmSync(root, { recursive: true, force: true }); fs.rmSync(hook, { recursive: true, force: true }); }
});

test('python: the hook keeps a PYTHONPATH the test command already sets', () => {
  const hook = tmp();
  try {
    const p = probe.prepare(hook, { runner: 'pytest', modules: ['x'], existing: { PYTHONPATH: 'src' } });
    assert.equal(p.env.PYTHONPATH, `${hook}${path.delimiter}src`);
  } finally { fs.rmSync(hook, { recursive: true, force: true }); }
});

function runNode(root, hookDir, modules, script) {
  const p = probe.prepare(hookDir, { runner: 'node-test', modules });
  const r = spawnSync('node', ['-e', script], { cwd: root, env: { ...process.env, ...p.env }, encoding: 'utf8' });
  assert.equal(r.status, 0, r.stderr);
  return probe.evaluate(p.out, { runner: 'node-test', modules, root });
}

test('node: project files loaded from the tree are accepted', () => {
  const root = tmp(); const hook = tmp();
  try {
    write(path.join(root, 'lib/command.js'), 'module.exports = 1;\n');
    const r = runNode(root, hook, ['commander'], "require('./lib/command.js')");
    assert.equal(r.ok, true, r.problems.join('; '));
    assert.deepEqual(r.seen, ['lib/command.js']);
  } finally { fs.rmSync(root, { recursive: true, force: true }); fs.rmSync(hook, { recursive: true, force: true }); }
});

test('node: a watched package loaded from node_modules outside the tree is reported', () => {
  const root = tmp(); const hook = tmp(); const host = tmp();
  try {
    write(path.join(host, 'node_modules/commander/index.js'), 'module.exports = 2;\n');
    write(path.join(root, 'lib/a.js'), 'module.exports = 1;\n');
    const r = runNode(root, hook, ['commander'], `require('./lib/a.js'); require(${JSON.stringify(path.join(host, 'node_modules/commander/index.js'))})`);
    assert.equal(r.ok, false);
    assert.match(r.problems[0], /commander was loaded from .*outside the task tree/);
  } finally { for (const d of [root, hook, host]) fs.rmSync(d, { recursive: true, force: true }); }
});

test('node: a run that loads no project file proves nothing', () => {
  const root = tmp(); const hook = tmp();
  try {
    const r = runNode(root, hook, ['commander'], '1+1');
    assert.equal(r.ok, false);
    assert.match(r.problems[0], /location is unproven/);
  } finally { fs.rmSync(root, { recursive: true, force: true }); fs.rmSync(hook, { recursive: true, force: true }); }
});
