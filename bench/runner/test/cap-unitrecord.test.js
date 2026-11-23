// SPDX-License-Identifier: Apache-2.0
'use strict';

// The keep-or-prune stage record of stages 2 to 4 (DEBT D-171): bench/schema/keep-prune-unit-stage.schema.json, checked
// on write and on read, with the depth blocks checked against the skill record's block schema. Free.

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { tmp, write } = require('./helpers.js');
const { runUnitStage } = require('../../cap/unitstage.js');
const { UNIT_SCHEMA_ID, unitRecordProblems, writeUnitRecord, readUnitRecord } = require('../../cap/unitrecord.js');
const { unitManifest } = require('../../cap/units.js');

const spec = (name, contexts = [], subagents = []) => JSON.stringify({ name, config: { description: `${name} desc`, systemPrompt: `You are ${name}.` },
  dependencies: { skills: { skillNames: [] }, agentSops: { agentSopNames: [] }, context: { contextNames: contexts }, subagents: { agentNames: subagents } } });

/** A small tree, its context unit k-rules with a frozen baseline, and one stub stage record of it. */
function rig() {
  const root = tmp();
  const repo = path.join(root, 'repo');
  write(path.join(repo, 'agents', 'konductor.agent-spec.json'), spec('konductor', ['k-rules.md'], ['k-dev']));
  write(path.join(repo, 'agents', 'k-dev.agent-spec.json'), spec('k-dev', ['k-rules.md']));
  write(path.join(repo, 'context', 'k-rules.md'), '# Rules\n\nEnd with `SUMMARY:`.\n');
  const baselines = path.join(root, 'unit-baselines');
  const tasks = (b) => Array.from({ length: 8 }, (_, i) => ({ id: `${b}-${i}`, prompt: `Plan ${b} ${i}.`, rubric: ['The answer has a `SUMMARY:` line.', 'The plan is in order.'] }));
  write(path.join(baselines, 'context-k-rules', 'baseline.json'), JSON.stringify({ format_version: 1, kind: 'context', name: 'k-rules', unit_sha256: unitManifest({ repo, kind: 'context', name: 'k-rules' }).sha256, source: { commit: null, writtenBy: 'a', reviewedBy: 'b' }, batches: [{ batch: 'b1', tasks: tasks('b1') }, { batch: 'b2', tasks: tasks('b2') }] }));
  const { record, file } = runUnitStage({ kind: 'context', name: 'k-rules', repo, runId: 'stub-r', outDir: path.join(root, 'out'), baselinesDir: baselines });
  return { root, repo, baselines, record, file, cleanup: () => fs.rmSync(root, { recursive: true, force: true }) };
}

test('a stub stage record is valid at major 1, and both depth blocks pass the skill record block schema', () => {
  const r = rig();
  try {
    assert.equal(r.record.schema, UNIT_SCHEMA_ID);
    assert.equal(UNIT_SCHEMA_ID, 'keep-prune-unit-stage/1');
    assert.deepEqual(unitRecordProblems(r.record), []);
    assert.ok(r.record.quick && r.record.deep);
  } finally { r.cleanup(); }
});

test('a record with a missing field, a bad block, a stage that does not match its kind, or a broken agree is refused on write', () => {
  const r = rig();
  try {
    const file = path.join(r.root, 'x.json');
    const { signoff, ...noSignoff } = r.record;
    assert.ok(signoff);
    assert.throws(() => writeUnitRecord(file, noSignoff), /signoff/);
    assert.throws(() => writeUnitRecord(file, { ...r.record, quick: { ...r.record.quick, label: undefined } }), /quick/);
    assert.throws(() => writeUnitRecord(file, { ...r.record, stage: 2 }), /stage 2 is not the stage of a context unit \(4\)/);
    assert.throws(() => writeUnitRecord(file, { ...r.record, agree: !r.record.agree }), /agree/);
    assert.equal(fs.existsSync(file), false, 'nothing is written');
  } finally { r.cleanup(); }
});

test('a reader refuses an unknown major and marks a record stale when the unit changed', () => {
  const r = rig();
  try {
    const v2 = path.join(r.root, 'v2.json');
    fs.writeFileSync(v2, JSON.stringify({ ...r.record, schema: 'keep-prune-unit-stage/2' }));
    assert.throws(() => readUnitRecord(v2), /major version 2 is unknown/);
    assert.equal(readUnitRecord(r.file, { repo: r.repo }).stale.value, false);
    fs.appendFileSync(path.join(r.repo, 'context', 'k-rules.md'), 'Another rule.\n');
    const stale = readUnitRecord(r.file, { repo: r.repo });
    assert.equal(stale.stale.value, true);
    assert.match(stale.stale.why, /the unit changed after the record was made/);
  } finally { r.cleanup(); }
});

// Per-task gaps and the reviewers' task grades (KEEP, WEAK, BAD) printed beside them: a reader of a pilot record sees
// which gaps come from tasks a review already distrusted.
const { taskGaps, readTaskGrades, renderUnitRecord } = require('../../cap/unitrecord.js');

const row = (task, reading, arm, replicate, median) => ({ task, batch: 'b1', reading, arm, replicate, median, judges: [] });

test('taskGaps is the mean with median minus the mean without median, per task and reading, null when one is missing', () => {
  const block = { scores: [
    row('t2', 'A', 'with', 0, 4), row('t2', 'A', 'without', 0, 2), row('t2', 'B', 'with', 0, 3), row('t2', 'B', 'without', 0, null),
    row('t1', 'A', 'with', 0, 5), row('t1', 'A', 'with', 1, 3), row('t1', 'A', 'without', 0, 1), row('t1', 'A', 'without', 1, 1), row('t1', 'A', 'aa', 0, 5),
  ] };
  assert.deepEqual(taskGaps(block), [{ task: 't2', A: 2, B: null }, { task: 't1', A: 3, B: null }]);
  assert.deepEqual(taskGaps({ scores: [] }), []);
});

test('readTaskGrades reads a review file, and refuses an unknown grade or a task the baseline does not have', () => {
  const r = rig();
  try {
    const file = path.join(r.root, 'review.json');
    assert.equal(readTaskGrades(file, ['b1-0']), null, 'no file: no grades');
    fs.writeFileSync(file, JSON.stringify({ format_version: 1, reviewers: ['x', 'y'], rule: 'the lower of the two', grades: { 'b1-0': 'BAD', 'b1-1': 'KEEP' } }));
    assert.deepEqual(readTaskGrades(file, ['b1-0', 'b1-1', 'b1-2']), { reviewers: ['x', 'y'], rule: 'the lower of the two', grades: { 'b1-0': 'BAD', 'b1-1': 'KEEP' } });
    assert.throws(() => readTaskGrades(file, ['b1-0']), /b1-1 is not a task of the baseline/);
    fs.writeFileSync(file, JSON.stringify({ format_version: 1, reviewers: ['x'], grades: { 'b1-0': 'GOOD' } }));
    assert.throws(() => readTaskGrades(file, ['b1-0']), /b1-0: grade "GOOD" is not KEEP, WEAK or BAD/);
  } finally { r.cleanup(); }
});

test('the rendered record lists each task with its gaps, and its review grade beside them when there is one', () => {
  const r = rig();
  try {
    const plain = renderUnitRecord(r.record);
    assert.match(plain, /\| task \| grade \| quick gap A \| quick gap B \| deep gap A \| deep gap B \|/);
    const num = '-?\\d+\\.\\d\\d';
    assert.match(plain, new RegExp(`\\| b1-0 \\| - \\| ${num} \\| ${num} \\| ${num} \\| ${num} \\|`));
    const { A, B } = taskGaps(r.record.quick).find((g) => g.task === 'b1-0');
    const graded = renderUnitRecord(r.record, { reviewers: ['x', 'y'], rule: 'the lower of the two', grades: { 'b1-0': 'BAD' } });
    assert.ok(graded.includes(`| b1-0 | BAD | ${A.toFixed(2)} | ${B.toFixed(2)} |`), 'the grade sits beside the gaps of its own task');
    assert.match(graded, /\| b1-1 \| - \|/);
    assert.match(graded, /Task grades by x and y \(the lower of the two\): read a BAD task's gap as noise/);
  } finally { r.cleanup(); }
});
