// SPDX-License-Identifier: Apache-2.0
'use strict';

// T4 batch checks: the dry-run score rule, the findings helper, the layout of each task, the hidden helper copies,
// and that nothing names a host path. The IAM evaluator has its own tests in lib/iam-eval.test.js.

const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const { codeScore } = require('./dry-run.js');
const { readFindingsBlock, findItem, atLeast } = require('./lib/findings.js');

const DIR = __dirname;
const ids = fs.readdirSync(DIR).filter((f) => /^t4-.*\.json$/.test(f)).map((f) => f.replace(/\.json$/, ''));
const tasks = ids.map((id) => JSON.parse(fs.readFileSync(path.join(DIR, `${id}.json`), 'utf8')));

test('codeScore weighs hidden tests 0.5 and substance checks 0.2, and skips format and tests checks', () => {
  const r = codeScore([
    { type: 'tests', tests: { passed: 5, total: 10 } },
    { type: 'cmd', passed: true, weight: 3, kind: 'substance' },
    { type: 'contains', passed: false, weight: 1, kind: 'substance' },
    { type: 'contains', passed: false, weight: 5, kind: 'format' },
  ]);
  assert.equal(r.hidden, 0.5);
  assert.equal(r.checks, 0.75);
  assert.ok(Math.abs(r.score - ((0.5 * 0.5 + 0.2 * 0.75) / 0.7) * 100) < 1e-9);
  assert.equal(codeScore([{ type: 'cmd', passed: true }]).score, 100);
});

test('findings helper reads the first json block and matches on word edges, synonyms and severity', () => {
  const doc = 'Intro\n```json\n[{"component":"AdminApi","threat":"one shared admin key, never rotated","severity":"High"}]\n```\n';
  const list = readFindingsBlock(doc);
  assert.equal(list.length, 1);
  assert.ok(findItem(list, { where: ['AdminApi'], about: [['rotate', 'rotated'], ['shared']], min: 2 }));
  assert.equal(findItem(list, { where: ['Admin'], whereFields: ['component'], about: ['shared'] }), null);
  assert.ok(atLeast(list[0], 'high') && !atLeast(list[0], 'critical'));
  assert.equal(readFindingsBlock('no block'), null);
});

test('every task has its fixture, hidden tests and reference, and its ids match', () => {
  for (const t of tasks) {
    assert.equal(t.hidden, t.id);
    assert.equal(t.fixture, t.twinOf || t.id);
    for (const d of [['fixtures', t.fixture], ['hidden', t.id], ['solutions', t.id]]) assert.ok(fs.existsSync(path.join(DIR, ...d)), d.join('/'));
    assert.ok(fs.existsSync(path.join(DIR, 'briefs', `${t.id}.json`)), `brief ${t.id}`);
    assert.ok(t.limits.hardSec === t.timeoutSec && t.limits.softSec * 2 === t.limits.hardSec, `${t.id} limits`);
  }
});

test('hidden helpers are byte-identical copies of lib/', () => {
  const copies = [['iam-eval.js', 'iam-eval.js'], ['findings.js', 'findings.js'], ['py-bridge.test.js', 'py_bridge.test.js'], ['py-timeouts.py', path.join('py', 'timeouts.py')]];
  for (const t of tasks) {
    for (const [lib, rel] of copies) {
      const copy = path.join(DIR, 'hidden', t.id, 'hidden', rel);
      if (fs.existsSync(copy)) assert.equal(fs.readFileSync(copy, 'utf8'), fs.readFileSync(path.join(DIR, 'lib', lib), 'utf8'), `${t.id} ${rel}`);
    }
  }
});

test('no task file, fixture, hidden test or reference names a host path', () => {
  const bad = /\/(home|local|Users)\/[a-z][\w.-]*\/|\.kiro\/crew|KIROCREW/;
  const walk = (dir) => fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? walk(path.join(dir, e.name)) : [path.join(dir, e.name)]));
  const files = [...ids.map((id) => path.join(DIR, `${id}.json`)), ...['fixtures', 'hidden', 'solutions'].filter((d) => fs.existsSync(path.join(DIR, d))).flatMap((d) => walk(path.join(DIR, d)))];
  for (const f of files) assert.doesNotMatch(fs.readFileSync(f, 'utf8'), bad, path.relative(DIR, f));
});
