// SPDX-License-Identifier: Apache-2.0
'use strict';

// Keep-or-prune stages 2 to 4 (bench/cap/unitstage.js): the stage runner skeleton on the stub provider (stub- runs
// only, no model), the unit baseline format, and the dry-run cost estimate. Free: files and the stub only.

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { tmp, write } = require('./helpers.js');
const { runUnitStage, estimateStage, loadUnitBaseline, COSTS, cmdUnitStage } = require('../../cap/unitstage.js');
const { unitManifest } = require('../../cap/units.js');

const REPO = path.join(__dirname, '..', '..', '..');
const spec = (name, extra = {}) => JSON.stringify({ name, config: { description: `${name} desc`, systemPrompt: extra.prompt ?? `You are ${name}.` },
  dependencies: { skills: { skillNames: [] }, agentSops: { agentSopNames: extra.sops ?? [] }, context: { contextNames: extra.contexts ?? [] }, subagents: { agentNames: extra.subagents ?? [] } } });

/** A tree with one context file whose text carries the conventions the stub agent follows, and a baseline for it. */
function rig({ freeze = true, edit = false } = {}) {
  const root = tmp();
  const repo = path.join(root, 'repo');
  write(path.join(repo, 'agents', 'konductor.agent-spec.json'), spec('konductor', { contexts: ['k-rules.md'], subagents: ['k-dev'] }));
  write(path.join(repo, 'agents', 'k-dev.agent-spec.json'), spec('k-dev', { contexts: ['k-rules.md'] }));
  write(path.join(repo, 'context', 'k-rules.md'), '# Rules\n\nEnd with `SUMMARY:` and list `RISKS:`.\n');
  const baselines = path.join(root, 'unit-baselines');
  if (freeze) {
    const sha = unitManifest({ repo, kind: 'context', name: 'k-rules' }).sha256;
    const tasks = (batch) => Array.from({ length: 8 }, (_, i) => ({ id: `${batch}-${i}`, prompt: `Plan change ${batch} ${i}.`, rubric: ['The answer has a `SUMMARY:` line.', 'The answer lists `RISKS:`.', 'The plan is in order.'] }));
    write(path.join(baselines, 'context-k-rules', 'baseline.json'), JSON.stringify({
      format_version: 1, kind: 'context', name: 'k-rules', unit_sha256: sha, source: { commit: null, writtenBy: 'test', reviewedBy: 'test' },
      batches: [{ batch: 'b1', tasks: tasks('b1') }, { batch: 'b2', tasks: tasks('b2') }],
    }));
  }
  if (edit) fs.appendFileSync(path.join(repo, 'context', 'k-rules.md'), 'One more rule.\n');
  return { root, repo, baselines, out: path.join(root, 'out'), cleanup: () => fs.rmSync(root, { recursive: true, force: true }) };
}

test('the stage runner refuses a run id that is not stub, any provider but the stub, and a skill (stage 1)', () => {
  const r = rig();
  try {
    const base = { kind: 'context', name: 'k-rules', repo: r.repo, outDir: r.out, baselinesDir: r.baselines };
    assert.throws(() => runUnitStage({ ...base, runId: 'real-1' }), /stub/);
    assert.throws(() => runUnitStage({ ...base, runId: 'stub-x', provider: 'bedrock' }), /not available/);
    assert.throws(() => runUnitStage({ ...base, kind: 'skill', runId: 'stub-x' }), /stage 1/);
  } finally { r.cleanup(); }
});

test('with a fresh baseline, the stub stage 4 run reads both depths through the real pipeline and names its drop arm', () => {
  const r = rig();
  try {
    const { record, file } = runUnitStage({ kind: 'context', name: 'k-rules', repo: r.repo, runId: 'stub-t', outDir: r.out, baselinesDir: r.baselines });
    assert.equal(file, path.join(r.out, 'stub-t', 'stage-4', 'context-k-rules.json'));
    assert.equal(record.stage, 4);
    assert.equal(record.schema, 'keep-prune-unit-stage/1');
    assert.equal(record.ablation.command, 'cap variant --drop context:k-rules');
    assert.equal(record.selection.test, 'none: always loaded');
    assert.deepEqual(record.noData, []);
    for (const d of ['quick', 'deep']) {
      assert.equal(record[d].coverage.tasksTotal, 16, d);
      assert.equal(record[d].judges.length, 3, d);
      assert.ok(record[d].judges.every((j) => j.family !== 'anthropic'), 'no judge shares the agent family');
    }
    assert.match(record.claim, /stub data/);
    assert.deepEqual(record.signoff, { by: null, date: null, decision: null, note: null });
    assert.ok(fs.existsSync(file.replace(/\.json$/, '.md')));
  } finally { r.cleanup(); }
});

test('no baseline, a stale baseline, an entry agent or too few judge families each make the stage NO DATA with the reason', () => {
  const none = rig({ freeze: false });
  try {
    const { record } = runUnitStage({ kind: 'context', name: 'k-rules', repo: none.repo, runId: 'stub-t', outDir: none.out, baselinesDir: none.baselines });
    assert.match(record.noData[0], /no frozen baseline for context:k-rules/);
    assert.equal(record.quick, null);
    const entry = runUnitStage({ kind: 'agent', name: 'konductor', repo: none.repo, runId: 'stub-t', outDir: none.out, baselinesDir: none.baselines }).record;
    assert.match(entry.noData[0], /^entry agent/);
  } finally { none.cleanup(); }
  const stale = rig({ edit: true });
  try {
    const { record } = runUnitStage({ kind: 'context', name: 'k-rules', repo: stale.repo, runId: 'stub-t', outDir: stale.out, baselinesDir: stale.baselines });
    assert.match(record.noData.join('; '), /the unit changed after its baseline was frozen/);
    assert.equal(record.quick, null);
  } finally { stale.cleanup(); }
  const fewJudges = rig();
  try {
    const { record } = runUnitStage({ kind: 'context', name: 'k-rules', repo: fewJudges.repo, runId: 'stub-t', outDir: fewJudges.out, baselinesDir: fewJudges.baselines, judges: ['deepseek-v3.2', 'claude-opus-5'] });
    assert.match(record.quick.noData[0], /not enough judge families/);
  } finally { fewJudges.cleanup(); }
});

test('a unit baseline needs two batches of 8 tasks, each with a prompt and a rubric', () => {
  const r = rig();
  try {
    const file = path.join(r.baselines, 'context-k-rules', 'baseline.json');
    assert.equal(loadUnitBaseline(file).batches.length, 2);
    const j = JSON.parse(fs.readFileSync(file, 'utf8'));
    j.batches[1].tasks.pop();
    fs.writeFileSync(file, JSON.stringify(j));
    assert.throws(() => loadUnitBaseline(file), /batch b2 has 7 tasks; a unit baseline has 2 batches of 8/);
  } finally { r.cleanup(); }
});

test('the dry-run estimate counts every call of a stage and prices it typical and worst case, in credits and USD', () => {
  const units = [{ id: 'sop:a', status: 'needs baseline' }, { id: 'sop:b', status: 'needs baseline' }, { id: 'sop:c', status: 'unreachable: no agent lists it' }];
  const e = estimateStage({ kind: 'sop', units });
  assert.equal(e.stage, 3);
  assert.equal(e.unitsRun, 2);
  // Per unit, 16 tasks: quick 32 answers, 16 checklists, 192 judge calls; deep (3 replicates, 3 arms) 144, 16, 864.
  assert.deepEqual(e.perUnit, { answers: 176, checklists: 32, judgeCalls: 1056, calls: 1264 });
  // Controls once per depth: the convention control (8 tasks) at both depths and the dose ladder (32 pairs) at both.
  // A ladder pair carries its rubric, so it makes no checklist call.
  assert.deepEqual(e.controls, { answers: 88, checklists: 16, judgeCalls: 912, calls: 1016 });
  assert.equal(e.calls, 2 * 1264 + 1016);
  assert.equal(e.credits.worst, e.calls * COSTS.credits.worstPerCall);
  assert.ok(e.credits.typical < e.credits.asAgentRuns && e.credits.asAgentRuns < e.credits.worst && e.usd.typical > 0);
  // The measured judge price (LITE median $0.005 per call) prices the judge calls in USD.
  assert.equal(COSTS.usd.judge, 0.005);
  // A pilot: one unit, quick only. 240 calls for the unit; controls 120 (convention) and 192 (ladder judges).
  const pilot = estimateStage({ kind: 'sop', units, depths: ['quick'], maxUnits: 1 });
  assert.equal(pilot.unitsRun, 1);
  assert.equal(pilot.calls, 240 + 120 + 192);
});

test('this checkout: the free estimate prints per stage, and a real (non-stub) run is never started', () => {
  const lines = [];
  const log = console.log;
  console.log = (m) => lines.push(m);
  try { cmdUnitStage({ kind: 'sop', estimate: true, 'repo-root': REPO }); } finally { console.log = log; }
  const text = lines.join('\n');
  assert.match(text, /stage 3 \(SOPs\): \d+ unit\(s\) to run/);
  assert.match(text, /worst case [\d,]+ credits/);
});
