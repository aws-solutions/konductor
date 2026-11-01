// SPDX-License-Identifier: Apache-2.0
'use strict';

// bench.js backfill: rewrites the stream-derived fields of finished engine v3 runs whose result.json missed them, from
// the saved stream.jsonl, with the runner's own code. A killed run keeps its censored credits. No model call.

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { tmp, write, makeBench, mkResult } = require('./helpers.js');
const { makeFakeKiro } = require('./fake-kiro.js');
const { executeRun } = require('../lib/run-one.js');
const { loadTasks } = require('../lib/tasks.js');
const { readLedger } = require('../lib/credit-ledger.js');
const { backfillAll, PRE_BACKFILL } = require('../lib/backfill.js');

const BENCH = path.join(__dirname, '..', 'bench.js');
const line = (o) => JSON.stringify(o);
const SID = 'sess_root';
const completion = (id, usage) => line({ type: 'sessionUpdate', data: { sessionId: SID, update: { sessionUpdate: 'session_info_update', _meta: { kiro: { kind: 'turn_completion', executionId: id, turnId: id, elapsedTime: 4321, promptTurnSummaries: [{ unit: 'credit', usage, usedTools: [] }], requestIds: [] } } } } });
const readCall = (id) => line({ type: 'sessionUpdate', data: { sessionId: SID, update: { sessionUpdate: 'tool_call', toolCallId: id, title: 'Read File', kind: 'read', rawInput: { path: 'a' }, _meta: { kiro: {} } } } });
const spawnCall = (id, callee) => line({ type: 'sessionUpdate', data: { sessionId: SID, update: { sessionUpdate: 'tool_call', toolCallId: id, title: 'Sub-agent: k-developer', rawInput: { name: 'k-developer', prompt: 'p' }, _meta: { kiro: { kind: 'agent-subtask', agentSubtaskId: callee } } } } });
const started = line({ type: 'runStarted', data: { engine: 'v3', payloadSchema: 'acp' } });
const finished = line({ type: 'runFinished', data: { sessionId: SID, status: 'success', stopReason: 'end_turn', finalText: 'done', finalTextTruncated: false } });

// What the runner wrote before it could read v3: no credits, no turn duration, every tool unknown.
const stale = (o = {}) => mkResult({
  harness: 'kiro-cli', agentEngine: 'v3', credits: null, creditsCensored: false, creditsLowerBound: null, creditsCharged: 0, turnDurationMs: null,
  modelCalls: { meteringEntries: 0, totalRequestCount: null }, toolCalls: 2, workToolCalls: 2, toolNames: { unknown: 2 }, subagentCalls: 0,
  orch: { spawns: 0, spawnCalls: 0, maxSpawnDepth: 0, childSessions: 0, reviewRounds: 0, reviewVerdicts: [], fixSpawns: 0, reworksAfterPass: 0, phaseDocs: null },
  flags: ['transcriptPartial'], ...o,
});

function put(cell, arm, task, rep, result, streamLines) {
  const dir = path.join(cell, arm, task, String(rep));
  write(path.join(dir, 'result.json'), `${JSON.stringify({ ...result, armId: arm, taskId: task, replicate: rep }, null, 2)}\n`);
  write(path.join(dir, 'stream.jsonl'), `${streamLines.join('\n')}\n`);
  return dir;
}

// A cell as a live v3 study left it: two finished runs (one delegates), a timeout, a run with credits, a killed run
// that did reach a turn_completion, and a ledger with the lines the old runner wrote.
function makeCell() {
  const root = tmp();
  const cell = path.join(root, 'claude');
  put(cell, 'vanilla', 't1', 1, stale(), [started, readCall('r1'), readCall('r2'), completion('e1', 2.5), finished]);
  put(cell, 'orch', 't1', 1, stale(), [started, readCall('r1'), spawnCall('invoke_subagent_1', 'A'), completion('e2', 9.25), finished]);
  put(cell, 'orch', 't2', 1, stale({ status: 'timeout', exitCode: null, runFinishedStatus: null, creditsCensored: true, creditsLowerBound: 0, creditsCharged: 1 }), [started, spawnCall('invoke_subagent_1', 'A')]);
  put(cell, 'vanilla', 't2', 1, stale({ credits: 3, creditsCharged: 3, turnDurationMs: 99, modelCalls: { meteringEntries: 1, totalRequestCount: null } }), [started, completion('e3', 3), finished]);
  put(cell, 'orch', 't3', 1, stale({ status: 'timeout', exitCode: null, runFinishedStatus: null, creditsCensored: true, creditsLowerBound: 0, creditsCharged: 1 }), [started, completion('e4', 7), spawnCall('invoke_subagent_1', 'A'), finished]);
  const ledger = [
    { at: '2026-11-01T03:00:00.000Z', kind: 'run', unit: 'credits', arm: 'vanilla', task: 't1', replicate: 1, status: 'success', credits: null, charged: 0, censored: false },
    { at: '2026-11-01T03:01:00.000Z', kind: 'run', unit: 'credits', arm: 'orch', task: 't1', replicate: 1, status: 'success', credits: null, charged: 0, censored: false },
    { at: '2026-11-01T03:02:00.000Z', kind: 'run', unit: 'credits', arm: 'orch', task: 't2', replicate: 1, status: 'timeout', credits: null, charged: 1, censored: true },
  ].map(line).join('\n');
  write(path.join(cell, 'credit-ledger.jsonl'), `${ledger}\n`);
  return { root, cell };
}

const snapshot = (dir) => Object.fromEntries(fs.readdirSync(dir, { recursive: true, withFileTypes: true }).filter((e) => e.isFile()).map((e) => [path.join(e.parentPath, e.name), fs.readFileSync(path.join(e.parentPath, e.name), 'utf8')]));
const read = (cell, arm, task) => JSON.parse(fs.readFileSync(path.join(cell, arm, task, '1', 'result.json'), 'utf8'));
const NOW = () => '2026-11-01T09:00:00.000Z';
const byRun = (out) => Object.fromEntries(out.map((r) => [`${r.armId}/${r.taskId}`, r]));

test('a dry run classifies every run and writes nothing', () => {
  const { root, cell } = makeCell();
  try {
    const before = snapshot(cell);
    const by = byRun(backfillAll({ runDir: cell, write: false, now: NOW }));
    assert.deepEqual(snapshot(cell), before);
    assert.equal(by['vanilla/t1'].status, 'recovered');
    assert.equal(by['vanilla/t1'].credits, 2.5);
    assert.equal(by['orch/t1'].credits, 9.25);
    assert.equal(by['vanilla/t2'].status, 'complete');
    assert.equal(by['orch/t2'].status, 'unrecoverable');
    assert.match(by['orch/t2'].reason, /timed out/);
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});

test('a killed run stays censored even when its stream reached a turn_completion', () => {
  const { root, cell } = makeCell();
  try {
    const by = byRun(backfillAll({ runDir: cell, write: true, now: NOW }));
    assert.equal(by['orch/t3'].status, 'unrecoverable');
    const r = read(cell, 'orch', 't3');
    assert.equal(r.credits, null);
    assert.equal(r.creditsCensored, true);
    assert.equal(fs.existsSync(path.join(cell, 'orch', 't3', '1', `result.json${PRE_BACKFILL}`)), false);
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});

test('a dry run on a killed run reports orchestration metrics its result.json lacks', () => {
  const { root, cell } = makeCell();
  try {
    const by = byRun(backfillAll({ runDir: cell, write: false, now: NOW }));
    assert.match(by['orch/t2'].note, /stream shows 1 spawn/);
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});

test('--write rewrites credit, tool and orchestration fields, keeps a pre-backfill copy and leaves the rest alone', () => {
  const { root, cell } = makeCell();
  try {
    const original = fs.readFileSync(path.join(cell, 'orch', 't1', '1', 'result.json'), 'utf8');
    backfillAll({ runDir: cell, write: true, now: NOW });
    const r = read(cell, 'orch', 't1');
    const was = JSON.parse(original);
    assert.equal(r.credits, 9.25);
    assert.equal(r.creditsCharged, 9.25);
    assert.equal(r.turnDurationMs, 4321);
    assert.deepEqual(r.modelCalls, { meteringEntries: 1, totalRequestCount: null });
    assert.deepEqual(r.toolNames, { read_file: 1, subagent: 1 });
    assert.equal(r.subagentCalls, 1);
    assert.equal(r.workToolCalls, 1);
    assert.equal(r.orch.spawns, 1);
    assert.equal(r.orch.maxSpawnDepth, 1);
    assert.deepEqual(r.creditsBackfill, { at: NOW(), source: 'stream.jsonl' });
    const untouched = (o) => { const { credits, creditsCharged, turnDurationMs, modelCalls, toolCalls, workToolCalls, toolNames, subagentCalls, orch, creditsBackfill, ...rest } = o; return rest; };
    assert.deepEqual(untouched(r), untouched(was));
    assert.equal(fs.readFileSync(path.join(cell, 'orch', 't1', '1', `result.json${PRE_BACKFILL}`), 'utf8'), original);
    assert.equal(read(cell, 'vanilla', 't2').credits, 3, 'a run that already has credits is left as it is');
    assert.equal(fs.existsSync(path.join(cell, 'vanilla', 't2', '1', `result.json${PRE_BACKFILL}`)), false);
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});

test('--write appends one backfill line per recovered run to the ledger and never edits the earlier lines', () => {
  const { root, cell } = makeCell();
  try {
    const file = path.join(cell, 'credit-ledger.jsonl');
    const before = fs.readFileSync(file, 'utf8');
    backfillAll({ runDir: cell, write: true, now: NOW });
    const after = fs.readFileSync(file, 'utf8');
    assert.ok(after.startsWith(before), 'earlier lines are byte-identical');
    const added = after.slice(before.length).trim().split('\n').map((l) => JSON.parse(l));
    assert.deepEqual(added.map((e) => [e.kind, e.arm, e.task, e.credits, e.charged]).sort(), [['backfill', 'orch', 't1', 9.25, 9.25], ['backfill', 'vanilla', 't1', 2.5, 2.5]]);
    assert.ok(added.every((e) => e.unit === 'credits' && e.censored === false && e.at === '2026-11-01T09:00:00.000Z'));
    assert.equal(readLedger(cell).totals.total, 1 + 2.5 + 9.25, 'the timeout keeps its 1.0 charge; the corrected runs add their credits');
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});

test('a second --write changes nothing', () => {
  const { root, cell } = makeCell();
  try {
    backfillAll({ runDir: cell, write: true, now: NOW });
    const after = snapshot(cell);
    const by = byRun(backfillAll({ runDir: cell, write: true, now: NOW }));
    assert.deepEqual(snapshot(cell), after);
    assert.equal(by['vanilla/t1'].status, 'complete');
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});

test('an interrupted write is finished by the next one without a duplicate ledger charge', () => {
  const { root, cell } = makeCell();
  try {
    backfillAll({ runDir: cell, write: true, now: NOW });
    // Undo the result.json rewrite of one run, as if the process died after the ledger line.
    const dir = path.join(cell, 'vanilla', 't1', '1');
    fs.copyFileSync(path.join(dir, `result.json${PRE_BACKFILL}`), path.join(dir, 'result.json'));
    backfillAll({ runDir: cell, write: true, now: NOW });
    assert.equal(read(cell, 'vanilla', 't1').credits, 2.5);
    assert.equal(readLedger(cell).totals.total, 1 + 2.5 + 9.25);
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});

test('a pre-backfill copy that differs from result.json is never overwritten', () => {
  const { root, cell } = makeCell();
  try {
    const copy = path.join(cell, 'vanilla', 't1', '1', `result.json${PRE_BACKFILL}`);
    fs.writeFileSync(copy, 'someone else\'s file');
    const by = byRun(backfillAll({ runDir: cell, write: true, now: NOW }));
    assert.equal(by['vanilla/t1'].status, 'unrecoverable');
    assert.match(by['vanilla/t1'].reason, /pre-backfill/);
    assert.equal(fs.readFileSync(copy, 'utf8'), 'someone else\'s file');
    assert.equal(read(cell, 'vanilla', 't1').credits, null);
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});

test('a run with no stream or no turn_completion is reported, not guessed', () => {
  const { root, cell } = makeCell();
  try {
    put(cell, 'vanilla', 't4', 1, stale(), [started, readCall('r1'), finished]);
    fs.rmSync(path.join(cell, 'orch', 't1', '1', 'stream.jsonl'));
    const by = byRun(backfillAll({ runDir: cell, write: true, now: NOW }));
    assert.match(by['vanilla/t4'].reason, /no turn_completion/);
    assert.match(by['orch/t1'].reason, /no stream/);
    assert.equal(read(cell, 'vanilla', 't4').credits, null);
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});

// ---- the backfill uses the runner's own code ----

const ARM = { id: 'vanilla', label: 'vanilla', ref: null, commitSha: null, harness: 'none', agent: null, vanilla: true };

test('the fields a backfill writes equal the ones a live v3 run records', async () => {
  const root = tmp();
  try {
    const bench = makeBench(path.join(root, 'bench'));
    const probe = path.join(root, 'probe');
    fs.mkdirSync(probe);
    makeFakeKiro(path.join(root, 'bin'), {
      dir: probe, credits: 1.75,
      toolCalls: [{ toolName: 'subagent', rawInput: { name: 'k-architect', prompt: 'p' }, rawOutput: 'ok' }, { toolName: 'read_file', rawInput: { path: 'a.txt' } }],
    });
    const authDb = path.join(root, 'data.sqlite3');
    fs.writeFileSync(authDb, 'fake-auth');
    const scratchDir = path.join(root, 'scratch');
    const watch = path.join(root, 'watch');
    fs.mkdirSync(scratchDir);
    fs.mkdirSync(watch);
    const outRoot = path.join(root, 'out');
    const ctx = {
      config: { model: 'claude-sonnet-5.5', effort: 'high', agentEngine: 'v3' }, scratchDir, authDb, envKeep: [], envInfo: { kiroCliVersion: 'fake', modelListSnapshotPath: null },
      isolation: { mode: 'none' }, tripwire: { roots: [{ dir: watch, depth: 2 }], extraExcludes: [], absExclude: [scratchDir, outRoot] },
    };
    const prevPath = process.env.PATH;
    process.env.PATH = `${path.join(root, 'bin')}${path.delimiter}${prevPath}`;
    let live;
    const dir = path.join(outRoot, 'vanilla', 't1', '1');
    try { live = await executeRun({ arm: ARM, task: loadTasks(bench).get('t1'), replicate: 1, ctx, prepared: null, outDir: dir }); } finally { process.env.PATH = prevPath; }
    assert.equal(live.credits, 1.75);
    const liveFile = JSON.parse(JSON.stringify(live));
    // Put back what the old runner would have written, then let the backfill fix it.
    const old = { ...liveFile, credits: null, creditsCharged: 0, turnDurationMs: null, modelCalls: { ...liveFile.modelCalls, meteringEntries: 0 }, toolNames: { unknown: 2 }, subagentCalls: 0, workToolCalls: 2, orch: { ...liveFile.orch, spawns: 0, spawnCalls: 0, maxSpawnDepth: 0, childSessions: 0 } };
    write(path.join(dir, 'result.json'), `${JSON.stringify(old, null, 2)}\n`);
    backfillAll({ runDir: outRoot, write: true, now: NOW });
    const fixed = JSON.parse(fs.readFileSync(path.join(dir, 'result.json'), 'utf8'));
    for (const k of ['credits', 'turnDurationMs', 'modelCalls', 'toolCalls', 'workToolCalls', 'toolNames', 'subagentCalls', 'orch']) assert.deepEqual(fixed[k], liveFile[k], k);
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});

// ---- command line ----

const cli = (args) => spawnSync('node', [BENCH, 'backfill', ...args], { encoding: 'utf8', env: { ...process.env, HOME: tmp() } });

test('the command is a dry run unless --write is given, and prints recovered and unrecoverable runs', () => {
  const { root, cell } = makeCell();
  try {
    const before = snapshot(cell);
    const dry = cli(['--run', cell]);
    assert.equal(dry.status, 0, dry.stderr);
    assert.deepEqual(snapshot(cell), before);
    assert.match(dry.stdout, /dry run/);
    assert.match(dry.stdout, /would recover 2/);
    assert.match(dry.stdout, /unrecoverable 2/);
    const wet = cli(['--run', cell, '--write']);
    assert.equal(wet.status, 0, wet.stderr);
    assert.match(wet.stdout, /recovered 2/);
    assert.equal(read(cell, 'vanilla', 't1').credits, 2.5);
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});

test('the command needs --run and rejects an unknown flag', () => {
  assert.notEqual(cli([]).status, 0);
  const bad = cli(['--run', '/nonexistent', '--writ']);
  assert.equal(bad.status, 2);
  assert.match(bad.stderr, /--writ/);
});
