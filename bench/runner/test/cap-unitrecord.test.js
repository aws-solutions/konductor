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
