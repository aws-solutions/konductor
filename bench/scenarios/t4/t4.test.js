// SPDX-License-Identifier: Apache-2.0
'use strict';

// T4 batch checks: the dry-run score rule, the findings helper, the layout of each task, the hidden helper copies,
// and that nothing names a host path. The IAM evaluator (bench/scenarios/lib/hidden/iam-eval.js) has its own tests in lib/iam-eval.test.js.

const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const { codeScore } = require('../lib/score.js');
const { readFindingsBlock, findItem, atLeast } = require('../lib/hidden/findings.js');

const { sharedHelpers } = require('../../runner/lib/hidden-lib.js');

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

// Owner rule (2026-11-19): threat-model, IAM design, IaC review and security-design tasks carry a judge-only expertKey whose
// items name their public source by name and URL.
const NEEDS_EXPERT_KEY = new Set(['t4-threat-model-webhooks', 't4-iam-ci-deploy-role', 't4-iam-lambda-role-split', 't4-iac-review-terraform', 't4-dev-sql-report-filters', 't4-arch-tenant-abac', 't4-iam-vendor-trust', 't4-iam-privesc-groups', 't4-iam-bucket-policy-oac', 't4-secrets-in-repo', 't4-dev-path-traversal-files']);
test('tasks that need an expertKey have one, with 3 to 5 weak answers and a named source URL per item', () => {
  for (const t of tasks.filter((x) => NEEDS_EXPERT_KEY.has(x.id))) {
    assert.ok(t.expertKey, `${t.id} has no expertKey`);
    assert.ok(t.expertKey.weakAnswers.length >= 3 && t.expertKey.weakAnswers.length <= 5, `${t.id} weakAnswers`);
    for (const it of t.expertKey.items) assert.match(it.source, /^\S.*, https:\/\/\S+/, `${t.id} ${it.id} source`);
  }
});

test('hidden dirs commit no copy of a shared helper; .bench-lib.json names them', () => {
  const names = fs.readdirSync(path.join(DIR, '..', 'lib', 'hidden'));
  const walk = (dir) => fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? walk(path.join(dir, e.name)) : [path.join(dir, e.name)]));
  for (const t of tasks) {
    const root = path.join(DIR, 'hidden', t.id);
    for (const f of walk(root)) assert.ok(!names.includes(path.basename(f)), `${path.relative(DIR, f)} is a copy of lib/hidden/${path.basename(f)}`);
    assert.doesNotThrow(() => sharedHelpers(root), t.id);
  }
});

test('no task file, fixture, hidden test or reference names a host path', () => {
  const bad = /\/(home|local|Users)\/[a-z][\w.-]*\/|\.kiro\/crew|KIROCREW/;
  const walk = (dir) => fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? walk(path.join(dir, e.name)) : [path.join(dir, e.name)]));
  const files = [...ids.map((id) => path.join(DIR, `${id}.json`)), ...['fixtures', 'hidden', 'solutions'].filter((d) => fs.existsSync(path.join(DIR, d))).flatMap((d) => walk(path.join(DIR, d)))];
  for (const f of files) assert.doesNotMatch(fs.readFileSync(f, 'utf8'), bad, path.relative(DIR, f));
});
