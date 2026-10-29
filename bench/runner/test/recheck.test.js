// SPDX-License-Identifier: Apache-2.0
'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const { tmp, write, makeBench, makeRun } = require('./helpers.js');
const { recheckRun, recheckAll, checksRevision } = require('../lib/recheck.js');
const { loadTasks } = require('../lib/tasks.js');
const { loadRun } = require('../../report/load.js');
const { buildReport } = require('../../report/aggregate.js');
const { renderMarkdown } = require('../../report/render.js');

const sha = (file) => crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');

// Task t1 originally required "x" in out.md; the revised task requires "y" instead.
function setup({ files = { 'out.md': 'has y only\n' }, extra = {} } = {}) {
  const root = tmp();
  const bench = makeBench(path.join(root, 'bench'));
  const oldChecks = [{ type: 'file_exists', path: 'out.md' }, { type: 'contains', path: 'out.md', pattern: 'x' }];
  const newChecks = [{ type: 'file_exists', path: 'out.md' }, { type: 'contains', path: 'out.md', pattern: 'y' }];
  const taskFile = path.join(bench, 'tasks/t1.json');
  const task = JSON.parse(fs.readFileSync(taskFile, 'utf8'));
  write(taskFile, JSON.stringify({ ...task, checks: newChecks }));
  const runDir = makeRun(path.join(root, 'run'), bench, [{
    arm: 'vanilla', files, credits: 1.5, creditsCharged: 1.5,
    checks: [{ ...oldChecks[0], passed: true, detail: 'present' }, { ...oldChecks[1], passed: false, detail: 'no match' }],
    ...extra,
  }]);
  return { root, bench, runDir, newChecks, oldChecks, resultFile: path.join(runDir, 'vanilla/t1/1/result.json'), cleanup: () => fs.rmSync(root, { recursive: true, force: true }) };
}

test('recheck replaces checks, keeps the originals and flags the revision', () => {
  const s = setup();
  try {
    const before = JSON.parse(fs.readFileSync(s.resultFile, 'utf8'));
    const [out] = recheckAll({ runDir: s.runDir, benchDir: s.bench, now: () => '2030-01-01T00:00:00.000Z' });
    assert.equal(out.status, 'rechecked');
    const after = JSON.parse(fs.readFileSync(s.resultFile, 'utf8'));
    assert.deepEqual(after.checks.map((c) => c.passed), [true, true]);
    assert.deepEqual(after.checksOriginal, before.checks);
    assert.equal(after.checksAllPassed, true);
    assert.equal(after.checksRevision, checksRevision(loadTasks(s.bench).get('t1')));
    assert.equal(after.checksRecheckedAt, '2030-01-01T00:00:00.000Z');
  } finally { s.cleanup(); }
});

test('recheck changes only the check fields: credits, status and every other field are untouched', () => {
  const s = setup();
  try {
    const stream = path.join(s.runDir, 'vanilla/t1/1/stream.jsonl');
    const streamSha = sha(stream);
    const before = JSON.parse(fs.readFileSync(s.resultFile, 'utf8'));
    recheckAll({ runDir: s.runDir, benchDir: s.bench });
    const after = JSON.parse(fs.readFileSync(s.resultFile, 'utf8'));
    const touched = ['checks', 'checksOriginal', 'checksRevision', 'checksRecheckedAt', 'checksAllPassed'];
    for (const k of Object.keys(before)) if (!touched.includes(k)) assert.deepEqual(after[k], before[k], k);
    assert.deepEqual(Object.keys(after).filter((k) => !(k in before)).sort(), touched.filter((k) => k !== 'checks').sort());
    assert.equal(after.credits, 1.5);
    assert.equal(after.creditsCharged, 1.5);
    assert.equal(sha(stream), streamSha);
  } finally { s.cleanup(); }
});

test('recheck is idempotent: a second run leaves the file byte-identical and keeps the first originals', () => {
  const s = setup();
  try {
    recheckAll({ runDir: s.runDir, benchDir: s.bench, now: () => '2030-01-01T00:00:00.000Z' });
    const once = sha(s.resultFile);
    const [out] = recheckAll({ runDir: s.runDir, benchDir: s.bench, now: () => '2031-01-01T00:00:00.000Z' });
    assert.equal(out.status, 'unchanged');
    assert.equal(sha(s.resultFile), once);
  } finally { s.cleanup(); }
});

test('a later task revision re-evaluates but still keeps the very first checks as originals', () => {
  const s = setup();
  try {
    const first = JSON.parse(fs.readFileSync(s.resultFile, 'utf8')).checks;
    recheckAll({ runDir: s.runDir, benchDir: s.bench });
    const taskFile = path.join(s.bench, 'tasks/t1.json');
    const task = JSON.parse(fs.readFileSync(taskFile, 'utf8'));
    write(taskFile, JSON.stringify({ ...task, checks: [{ type: 'contains', path: 'out.md', pattern: 'nomatch' }] }));
    const [out] = recheckAll({ runDir: s.runDir, benchDir: s.bench });
    assert.equal(out.status, 'rechecked');
    const after = JSON.parse(fs.readFileSync(s.resultFile, 'utf8'));
    assert.deepEqual(after.checksOriginal, first);
    assert.deepEqual(after.checks.map((c) => c.passed), [false]);
    assert.equal(after.checksAllPassed, false);
  } finally { s.cleanup(); }
});

test('the saved workspace snapshot is not modified, even by a check command that writes files', () => {
  const s = setup();
  try {
    const taskFile = path.join(s.bench, 'tasks/t1.json');
    const task = JSON.parse(fs.readFileSync(taskFile, 'utf8'));
    write(taskFile, JSON.stringify({ ...task, checks: [{ type: 'cmd', cmd: 'echo scratch > written-by-check.txt', expectExit: 0 }] }));
    const ws = path.join(s.runDir, 'vanilla/t1/1/workspace');
    const listing = () => fs.readdirSync(ws).sort().join(',');
    const before = listing();
    recheckAll({ runDir: s.runDir, benchDir: s.bench });
    assert.equal(listing(), before);
  } finally { s.cleanup(); }
});

test('runs without a workspace snapshot, without checks, or skipped by the budget are left alone', () => {
  const s = setup();
  try {
    fs.rmSync(path.join(s.runDir, 'vanilla/t1/1/workspace'), { recursive: true });
    const before = sha(s.resultFile);
    const [out] = recheckAll({ runDir: s.runDir, benchDir: s.bench });
    assert.equal(out.status, 'skipped');
    assert.match(out.reason, /no workspace/);
    assert.equal(sha(s.resultFile), before);
  } finally { s.cleanup(); }
  const t = setup({ extra: { status: 'budget_skipped', checks: [] } });
  try {
    const [out] = recheckAll({ runDir: t.runDir, benchDir: t.bench });
    assert.equal(out.status, 'skipped');
  } finally { t.cleanup(); }
});

test('dry run reports the new results without writing', () => {
  const s = setup();
  try {
    const before = sha(s.resultFile);
    const [out] = recheckAll({ runDir: s.runDir, benchDir: s.bench, dryRun: true });
    assert.equal(out.status, 'rechecked');
    assert.deepEqual(out.after.map((c) => c.passed), [true, true]);
    assert.equal(sha(s.resultFile), before);
  } finally { s.cleanup(); }
});

test('recheckRun refuses a task that is missing', () => {
  const s = setup();
  try {
    assert.throws(() => recheckRun({ dir: path.join(s.runDir, 'vanilla/t1/1'), task: undefined }), /task/);
  } finally { s.cleanup(); }
});

test('the report counts a recheck-passed run as a pass and says the results were rechecked', () => {
  const s = setup();
  try {
    const rep = () => buildReport({ run: loadRun(s.runDir), tasks: loadTasks(s.bench), baseline: 'vanilla' }).report;
    assert.equal(rep().arms.vanilla.overall.checkPassRate, 0);
    assert.equal(rep().checksRecheck, null);
    recheckAll({ runDir: s.runDir, benchDir: s.bench });
    const after = rep();
    assert.equal(after.arms.vanilla.overall.checkPassRate, 1);
    assert.deepEqual(after.checksRecheck, { rechecked: 1, runs: 1, flippedToPass: 1, flippedToFail: 0 });
    const md = renderMarkdown(after);
    assert.match(md, /rechecked/i);
    assert.match(md, /1 of 1 run/);
  } finally { s.cleanup(); }
});
