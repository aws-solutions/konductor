// SPDX-License-Identifier: Apache-2.0
'use strict';

// The orchestration metrics in result.json, in contrast and in the run report. Fixture runs only.

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { tmp, write, makeBench, makeRun } = require('./helpers.js');
const { makeFakeKiro } = require('./fake-kiro.js');
const { executeRun } = require('../lib/run-one.js');
const { loadTasks } = require('../lib/tasks.js');
const { loadRun } = require('../../report/load.js');
const { contrastRun, renderContrast } = require('../../report/contrast.js');
const orch = require('../../report/orch.js');
const { validateResult } = require('../lib/result.js');
const { generateRunReport, generateContrast } = require('../../report/generate.js');

const call = (session, id, input) => ({ type: 'sessionUpdate', data: { sessionId: session, update: { sessionUpdate: 'tool_call', toolCallId: id, _meta: { kiro: { toolName: 'subagent' } }, rawInput: input } } });
const done = (session, id, out) => ({ type: 'sessionUpdate', data: { sessionId: session, update: { sessionUpdate: 'tool_call_update', toolCallId: id, status: 'completed', rawOutput: out } } });
const meta = (s) => ({ type: 'metadata', data: { sessionId: s } });
const brief = (task) => ({ stages: [{ name: 'x', role: 'k-developer', prompt_template: `TASK: ${task}` }] });

// Overwrites the stream of one run directory with spawns: [{task, out}] made by the root session.
function setStream(dir, spawns) {
  const ev = [meta('root')];
  spawns.forEach((s, i) => ev.push(call('root', `c${i}`, brief(s.task)), meta(`s${i}`), done('root', `c${i}`, s.out)));
  write(path.join(dir, 'stream.jsonl'), ev.map((e) => JSON.stringify(e)).join('\n') + '\n');
}

function setup(armSpawns) {
  const root = tmp();
  const bench = makeBench(path.join(root, 'bench'));
  const specs = [];
  for (const [arm, perRun] of Object.entries(armSpawns)) perRun.forEach((_, i) => specs.push({ arm, rep: i + 1, credits: 5 }));
  const runDir = makeRun(path.join(root, 'run'), bench, specs);
  for (const [arm, perRun] of Object.entries(armSpawns)) perRun.forEach((sp, i) => setStream(path.join(runDir, arm, 't1', String(i + 1)), sp));
  return { root, bench, runDir, done: () => fs.rmSync(root, { recursive: true, force: true }) };
}

const REVIEW_FAIL = { task: 'Review the change', out: 'Verdict: FAIL. 1 IMPORTANT: x' };
const REVIEW_PASS = { task: 'Review the change', out: 'Verdict: PASS' };
const FIX = { task: 'Fix the review findings', out: 'done' };
const BUILD = { task: 'Implement it', out: 'done' };

test('enrichOrch computes orch from the run directory when result.json has none, and keeps a stored one', () => {
  const s = setup({ a: [[BUILD, REVIEW_PASS, FIX]], b: [[]] });
  try {
    const stored = { spawns: 99, spawnCalls: 99, maxSpawnDepth: 9, reviewRounds: 9, reworksAfterPass: 9, phaseDocs: null };
    const bFile = path.join(s.runDir, 'b/t1/1/result.json');
    fs.writeFileSync(bFile, JSON.stringify({ ...JSON.parse(fs.readFileSync(bFile, 'utf8')), orch: stored }));
    const run = loadRun(s.runDir);
    orch.enrichOrch(run);
    const a = run.runs.find((r) => r.armId === 'a').result.orch;
    assert.deepEqual({ spawns: a.spawns, depth: a.maxSpawnDepth, rounds: a.reviewRounds, rw: a.reworksAfterPass }, { spawns: 3, depth: 1, rounds: 1, rw: 1 });
    assert.equal(run.runs.find((r) => r.armId === 'a').orchSource, 'backfilled');
    assert.equal(run.runs.find((r) => r.armId === 'b').result.orch.spawns, 99, 'a stored value is not recomputed');
    assert.equal(run.runs.find((r) => r.armId === 'b').orchSource, 'stored');
  } finally { s.done(); }
});

test('a run with no stream gets no orch and is left out of the means', () => {
  const s = setup({ a: [[BUILD], [BUILD]] });
  try {
    fs.rmSync(path.join(s.runDir, 'a/t1/2/stream.jsonl'));
    const run = loadRun(s.runDir);
    orch.enrichOrch(run);
    assert.equal(run.runs.find((r) => r.replicate === 2).result.orch ?? null, null);
    const sum = orch.summarize(run).find((x) => x.arm === 'a');
    assert.equal(sum.runs, 2);
    assert.equal(sum.withData, 1);
  } finally { s.done(); }
});

test('contrast shows spawns, depth, review rounds and reworks after a pass for both arms', () => {
  const reps = (n, sp) => Array.from({ length: n }, () => sp);
  const s = setup({
    base: reps(4, []),
    head: reps(4, [BUILD, REVIEW_PASS, FIX]),
  });
  try {
    const c = contrastRun({ run: (() => { const r = loadRun(s.runDir); return r; })(), tasks: loadTasks(s.bench), base: 'base' });
    const m = c.cells.head.overall.metrics;
    assert.equal(m.spawns.base, 0);
    assert.equal(m.spawns.head, 3);
    assert.equal(m.maxSpawnDepth.head, 1);
    assert.equal(m.reviewRounds.head, 1);
    assert.equal(m.reworksAfterPass.head, 1);
    assert.equal(m.reworksAfterPass.base, 0);
    assert.match(renderContrast(c), /spawns/);
    assert.match(renderContrast(c), /reworks after a pass/);
  } finally { s.done(); }
});

test('phase-document rows appear only when phases are asked for, and count a missing document against the arm', () => {
  const s = setup({ base: [[], [], [], []], head: [[BUILD], [BUILD], [BUILD], [BUILD]] });
  try {
    for (let i = 1; i <= 4; i++) {
      write(path.join(s.runDir, `head/t1/${i}/workspace/.konductor/design/system-design.md`), '# d\n');
      write(path.join(s.runDir, `base/t1/${i}/workspace/.konductor/design/system-design.md`), '# d\n');
    }
    write(path.join(s.runDir, 'base/t1/1/workspace/.konductor/design/principal-engineer-review.md'), '# r\n');
    const without = contrastRun({ run: loadRun(s.runDir), tasks: loadTasks(s.bench), base: 'base' });
    assert.equal(without.cells.head.overall.metrics.phaseDocsPresent, undefined);
    const withPhases = contrastRun({ run: loadRun(s.runDir), tasks: loadTasks(s.bench), base: 'base', phases: ['design', 'design-review'] });
    const m = withPhases.cells.head.overall.metrics;
    assert.equal(m.phaseDocsPresent.head, 0.5, 'design present, review missing: 1 of 2');
    assert.equal(m.phaseDocsPresent.base, 0.625);
    assert.equal(m.phaseDocsComplete.head, 0);
    assert.equal(m.phaseDocsComplete.base, 0.25);
  } finally { s.done(); }
});

test('the run report block lists spawns, depth, review rounds, reworks and phase documents per arm', () => {
  const s = setup({ a: [[BUILD, REVIEW_FAIL, FIX, REVIEW_PASS, FIX]], b: [[BUILD]] });
  try {
    const run = loadRun(s.runDir);
    orch.enrichOrch(run);
    const blocks = orch.orchBlocks(run, { phases: ['design'] });
    const table = blocks.find((b) => b.t === 'table');
    assert.deepEqual(table.head.slice(0, 2), ['arm', 'runs']);
    const row = table.rows.find((r) => r[0] === 'a');
    assert.ok(row.includes('5.0'), 'mean spawns');
    assert.ok(row.includes('2.0'), 'mean review rounds');
    assert.ok(row.includes('1.0'), 'mean reworks after a pass');
    assert.match(JSON.stringify(blocks), /heuristic/);
  } finally { s.done(); }
});

test('executeRun stores orch in result.json from the stream and the workspace', async () => {
  const root = tmp();
  try {
    const bench = makeBench(path.join(root, 'bench'));
    const bin = path.join(root, 'bin');
    const probe = path.join(root, 'probe');
    fs.mkdirSync(probe);
    makeFakeKiro(bin, {
      dir: probe,
      files: { '.konductor/design/system-design.md': '# d\n' },
      toolCalls: [{ toolName: 'subagent', rawInput: brief('Review the change'), rawOutput: { items: [{ Text: 'Verdict: PASS' }] } }],
    });
    const authDb = path.join(root, 'data.sqlite3');
    fs.writeFileSync(authDb, 'fake-auth');
    const scratchDir = path.join(root, 'scratch');
    fs.mkdirSync(scratchDir);
    const watch = path.join(root, 'watch');
    fs.mkdirSync(watch);
    const ctx = {
      config: { model: 'claude-sonnet-5.5', effort: 'high', agentEngine: 'v2' }, scratchDir, authDb, envKeep: [], envInfo: { kiroCliVersion: 'fake', modelListSnapshotPath: null },
      isolation: { mode: 'none' }, tripwire: { roots: [{ dir: watch, depth: 2 }], extraExcludes: [], absExclude: [scratchDir, path.join(root, 'out')] },
    };
    const prev = process.env.PATH;
    process.env.PATH = `${bin}${path.delimiter}${prev}`;
    try {
      const arm = { id: 'vanilla', label: 'vanilla', ref: null, commitSha: null, harness: 'none', agent: null, vanilla: true };
      const r = await executeRun({ arm, task: loadTasks(bench).get('t1'), replicate: 1, ctx, prepared: null, outDir: path.join(root, 'out', 't1') });
      assert.equal(r.status, 'success');
      assert.equal(r.orch.spawnCalls, 1);
      assert.equal(r.orch.reviewRounds, 1);
      assert.deepEqual(r.orch.reviewVerdicts, ['pass']);
      assert.equal(r.orch.phaseDocs.phases.design.complete, true);
      assert.deepEqual(validateResult(r), []);
    } finally { process.env.PATH = prev; }
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});

test('the written run report and contrast carry the orchestration figures', () => {
  const s = setup({ base: [[], [], []], head: [[BUILD, REVIEW_PASS, FIX], [BUILD, REVIEW_PASS, FIX], [BUILD, REVIEW_PASS, FIX]] });
  try {
    const run = loadRun(s.runDir);
    const tasks = loadTasks(s.bench);
    const out = path.join(s.root, 'out');
    const r = generateRunReport({ run, tasks, baseline: 'base', out, detail: 'full', format: 'both', defaultDir: s.runDir, phases: ['design'] });
    const md = fs.readFileSync(path.join(out, 'report.md'), 'utf8');
    assert.match(md, /## Orchestration/);
    assert.match(md, /\| head \| 3 \| 3 \| 3\.0 \| 1 \| 1\.0 \| 1\.0 \|/);
    assert.match(md, /phase documents present/);
    assert.equal(r.json.orchestration.find((x) => x.arm === 'head').spawns, 3);
    assert.match(fs.readFileSync(path.join(out, 'report.html'), 'utf8'), /Orchestration/);
    const c = contrastRun({ run: loadRun(s.runDir), tasks, base: 'base' });
    generateContrast({ run: loadRun(s.runDir), tasks, c, out: path.join(s.root, 'cout'), detail: 'full', format: 'md', defaultDir: s.runDir });
    assert.match(fs.readFileSync(path.join(s.root, 'cout', 'contrast.md'), 'utf8'), /reworks after a pass/);
  } finally { s.done(); }
});
