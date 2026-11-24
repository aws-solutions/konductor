// SPDX-License-Identifier: Apache-2.0
'use strict';

// Every T2 task names its grader in .bench-lib.json (bench/scenarios/lib/hidden) and commits no copy of it; its key,
// fixture and reference are where the task file says. The shared hidden test honours a key's lengthAllowance.

const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { sharedHelpers } = require('../../../runner/lib/hidden-lib.js');
const { loadConfig } = require('../../lib/config.js');

const T2 = path.join(__dirname, '..');
const LIB = path.join(T2, '..', 'lib', 'hidden');
const cfg = loadConfig(path.join(T2, 'scenario.config.js'));
const tasks = () => fs.readdirSync(T2).filter((n) => /^t2-.*\.json$/.test(n)).map((n) => JSON.parse(fs.readFileSync(path.join(T2, n), 'utf8')));

test('every task file has its hidden key, its shared grader and its reference', () => {
  for (const task of tasks()) {
    const hidden = path.join(T2, 'hidden', task.hidden);
    const key = task.controlKind === 'twin' ? 'twin-key.json' : 'key.json';
    assert.ok(fs.existsSync(path.join(hidden, 'hidden', key)), `${task.id}: ${key}`);
    const helpers = sharedHelpers(hidden).map(([rel]) => rel);
    assert.ok(helpers.includes(task.controlKind === 'twin' ? 'hidden/twin.test.cjs' : 'hidden/findings.test.cjs'), `${task.id}: .bench-lib.json`);
    for (const rel of helpers) assert.ok(!fs.existsSync(path.join(hidden, rel)), `${task.id}: committed copy of ${rel}`);
    assert.ok(fs.existsSync(cfg.solutionDir(task.id)), `${task.id}: solution (its own, or its base task's for a -vN task)`);
    assert.ok(fs.existsSync(path.join(T2, 'fixtures', task.fixture)), `${task.id}: fixture`);
  }
});

test('every design review carries an expert key whose items name their public source', () => {
  for (const task of tasks().filter((t) => t.phase === 'design-review' && t.controlKind !== 'twin')) {
    assert.ok(task.expertKey, `${task.id}: expertKey`);
    for (const it of task.expertKey.items) assert.match(it.source, /^\S.*, https?:\/\//, `${task.id} ${it.id}`);
  }
});

// Runs the shared hidden test in a throwaway workspace: a review of `count` findings that hits every key item, under a
// key with the given lengthAllowance. Returns the passed share of the 20 slices.
function slicesPassed(lengthAllowance, count) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 't2-len-'));
  try {
    const hidden = path.join(root, 'hidden');
    fs.mkdirSync(hidden);
    for (const f of ['findings.test.cjs', 'findings-key.cjs']) fs.copyFileSync(path.join(LIB, f), path.join(hidden, f));
    const items = [1, 2, 3].map((i) => ({ id: `k${i}`, section: `${i}.1`, severity: 'high', fix: ['dedup'] }));
    fs.writeFileSync(path.join(hidden, 'key.json'), JSON.stringify({ output: 'REVIEW.md', items, ...(lengthAllowance === undefined ? {} : { lengthAllowance }) }));
    const findings = items.map((it) => ({ location: it.section, severity: 'high', issue: 'x', fix: 'add dedup' }));
    while (findings.length < count) findings.push({ location: `9.${findings.length}`, severity: 'low', issue: 'filler', fix: 'none' });
    fs.writeFileSync(path.join(root, 'REVIEW.md'), `# Review\n\n\`\`\`json\n${JSON.stringify(findings)}\n\`\`\`\n`);
    // Started from under node --test, a child inherits NODE_TEST_CONTEXT and would speak the runner's protocol, not TAP.
    const env = { ...process.env };
    delete env.NODE_TEST_CONTEXT;
    const out = spawnSync('node', ['--test', '--test-reporter=tap', 'hidden/findings.test.cjs'], { cwd: root, encoding: 'utf8', env }).stdout;
    return Number(/^# pass (\d+)/m.exec(out)[1]) / 20;
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
}

test('the shared hidden test scales a long review by the key lengthAllowance (default 3x), and a null allowance turns the length term off', () => {
  assert.equal(slicesPassed(undefined, 3), 1, 'a tight review earns everything');
  assert.equal(slicesPassed(undefined, 18), 0.5, 'twice the default allowance halves the score');
  assert.equal(slicesPassed(null, 18), 1, 'lengthAllowance null: no length term');
  assert.equal(slicesPassed(6, 18), 1, 'an explicit allowance that covers the list');
});
