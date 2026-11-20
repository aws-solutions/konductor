// SPDX-License-Identifier: Apache-2.0
'use strict';

// Fresh-session tasks (`freshSessions`): session 1 runs and ends, then each later prompt starts a NEW conversation in the
// same workspace, so files the agent saved are still there. Kiro CLI and Claude Code, against fake agents. No credits, no network.

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { tmp, write, makeBench } = require('./helpers.js');
const { makeFakeKiro } = require('./fake-kiro.js');
const { makeFakeClaude } = require('./fake-claude.js');
const { executeRun } = require('../lib/run-one.js');
const { loadTasks } = require('../lib/tasks.js');
const { validateResult } = require('../lib/result.js');
const { v3Errors } = require('../lib/task-v3.js');
const cc = require('../lib/harness/claude-code.js');

const MEMORY = '.konductor/memory/decision.md';
const SECOND = 'New session. Finish the change using what the team decided.';

function freshTask(bench, extra = {}) {
  const t = JSON.parse(fs.readFileSync(path.join(bench, 'tasks/t1.json'), 'utf8'));
  write(path.join(bench, 'tasks/t1.json'), JSON.stringify({ ...t, timeoutSec: 60, freshSessions: [{ prompt: SECOND }], ...extra }));
  return loadTasks(bench).get('t1');
}

function base(root) {
  const scratchDir = path.join(root, 'scratch');
  fs.mkdirSync(scratchDir);
  const watch = path.join(root, 'watch');
  fs.mkdirSync(watch);
  const probe = path.join(root, 'probe');
  fs.mkdirSync(probe);
  const tripwire = { roots: [{ dir: watch, depth: 2 }], extraExcludes: [], absExclude: [scratchDir, path.join(root, 'out')] };
  const turn = (n) => JSON.parse(fs.readFileSync(path.join(probe, `started-${n}.json`), 'utf8'));
  return { scratchDir, probe, tripwire, turn, outDir: path.join(root, 'out', 't1') };
}

// ---- Kiro CLI ----

const ARM = { id: 'vanilla', label: 'vanilla', ref: null, commitSha: null, harness: 'none', agent: null, vanilla: true };

function kiroSetup(turns, extra) {
  const root = tmp();
  const bench = makeBench(path.join(root, 'bench'));
  const task = freshTask(bench, extra);
  const b = base(root);
  const bin = path.join(root, 'bin');
  makeFakeKiro(bin, { dir: b.probe, sessionJson: true, probeFiles: [MEMORY], turns });
  const authDb = path.join(root, 'data.sqlite3');
  fs.writeFileSync(authDb, 'fake-auth');
  const ctx = {
    config: { model: 'claude-sonnet-5.5', effort: 'high', agentEngine: 'v2' }, scratchDir: b.scratchDir, authDb, envKeep: [],
    envInfo: { kiroCliVersion: 'fake', modelListSnapshotPath: null }, isolation: { mode: 'none' }, tripwire: b.tripwire,
  };
  const prevPath = process.env.PATH;
  process.env.PATH = `${bin}${path.delimiter}${prevPath}`;
  return { ...b, ctx, task, cleanup: () => { process.env.PATH = prevPath; fs.rmSync(root, { recursive: true, force: true }); } };
}

const runKiro = (s) => executeRun({ arm: ARM, task: s.task, replicate: 1, ctx: s.ctx, prepared: null, outDir: s.outDir, inFlightAtStart: 0 });

test('Kiro CLI: session 2 is a new conversation in the same workspace, sees the file session 1 saved, and both streams are recorded', async () => {
  const s = kiroSetup([
    { sessionId: 's1', credits: 1, finalText: 'Saved the decision.', files: { [MEMORY]: 'use seconds' } },
    { sessionId: 's2', credits: 2, finalText: 'Done.' },
  ]);
  try {
    const r = await runKiro(s);
    assert.equal(r.status, 'success', r.error);
    assert.deepEqual(validateResult(r), []);
    const [t1, t2] = [1, 2].map(s.turn);
    assert.equal(t1.args.at(-1), s.task.prompt);
    assert.equal(t2.args.at(-1), SECOND);
    assert.equal(t2.args.some((a) => a.startsWith('--resume')), false, 'no resume flag: a fresh conversation');
    assert.equal(t2.cwd, t1.cwd);
    assert.equal(t2.home, t1.home);
    assert.deepEqual(t1.seen, []);
    assert.deepEqual(t2.seen, [MEMORY], 'the file session 1 saved is still in the workspace');
    assert.deepEqual(r.sessions.map((x) => [x.session, x.stream, x.sessionId, x.runFinishedStatus, x.exitCode]), [[1, 'stream-1.jsonl', 's1', 'success', 0], [2, 'stream-2.jsonl', 's2', 'success', 0]]);
    assert.equal(r.sessionsPlanned, 2);
    for (const n of [1, 2]) assert.ok(fs.existsSync(path.join(s.outDir, `stream-${n}.jsonl`)));
    assert.equal(r.credits, 3, 'credits summed over both sessions');
    assert.equal(r.finalText, 'Done.');
    assert.match(fs.readFileSync(path.join(s.outDir, 'command.txt'), 'utf8'), /--- turn 2 \(fresh session, same workspace\) ---/);
    assert.equal(fs.readFileSync(path.join(s.outDir, 'workspace', MEMORY), 'utf8'), 'use seconds');
  } finally { s.cleanup(); }
});

test('Kiro CLI: a first session that fails ends the task and session 2 never starts', async () => {
  const s = kiroSetup([{ exitCode: 1, stderrText: 'boom' }, { finalText: 'Done.' }]);
  try {
    const r = await runKiro(s);
    assert.notEqual(r.status, 'success');
    assert.equal(fs.existsSync(path.join(s.probe, 'started-2.json')), false);
    assert.deepEqual(r.sessions.map((x) => x.session), [1]);
    assert.deepEqual(validateResult(r), []);
  } finally { s.cleanup(); }
});

test('Kiro CLI: a second session on another model fails the model check', async () => {
  const s = kiroSetup([{ sessionId: 's1', finalText: 'Saved.' }, { sessionId: 's2', finalText: 'Done.', model: 'claude-haiku-9' }]);
  try {
    const r = await runKiro(s);
    assert.equal(r.status, 'error');
    assert.ok(r.flags.includes('modelMismatch'), r.flags.join(','));
    assert.match(r.error, /claude-haiku-9/);
  } finally { s.cleanup(); }
});

test('freshSessions cannot be combined with a scripted user or an autonomy block', () => {
  assert.equal(v3Errors({ id: 'x', freshSessions: [{ prompt: 'p' }], autonomy: { clarifications: [] } }).filter((e) => /freshSessions cannot/.test(e)).length, 1);
  assert.equal(v3Errors({ id: 'x', freshSessions: [{ prompt: 'p' }], questions: 'scripted', scriptedUser: { facts: [], defaultReply: 'z' } }).filter((e) => /freshSessions cannot/.test(e)).length, 1);
});

// ---- Claude Code ----

const FX = path.join(__dirname, 'fixtures', 'claude-code');
const CC_ARM = { id: 'cc-vanilla', label: 'cc-vanilla', ref: null, commitSha: null, harness: 'claude-code', agent: null, vanilla: true };
const MODEL = 'us.anthropic.claude-sonnet-5-5';

// The recorded one-turn stream with its session id replaced.
function streamWithId(dir, name, sessionId) {
  const lines = fs.readFileSync(path.join(FX, 'vanilla-success.stream.jsonl'), 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l));
  for (const ev of lines) if (ev.session_id) ev.session_id = sessionId;
  const file = path.join(dir, name);
  fs.writeFileSync(file, `${lines.map((l) => JSON.stringify(l)).join('\n')}\n`);
  return { file, cost: lines.find((l) => l.type === 'result').total_cost_usd };
}

const withCreds = (fn) => {
  const keep = { id: process.env.AWS_ACCESS_KEY_ID, secret: process.env.AWS_SECRET_ACCESS_KEY, token: process.env.AWS_SESSION_TOKEN };
  Object.assign(process.env, { AWS_ACCESS_KEY_ID: 'AKIAFAKEFAKEFAKE0001', AWS_SECRET_ACCESS_KEY: 'fake/secret/key/for/the/test/only/0000000', AWS_SESSION_TOKEN: 'faketoken0123456789' });
  const restore = () => { for (const [k, v] of [['AWS_ACCESS_KEY_ID', keep.id], ['AWS_SECRET_ACCESS_KEY', keep.secret], ['AWS_SESSION_TOKEN', keep.token]]) { if (v === undefined) delete process.env[k]; else process.env[k] = v; } };
  return fn().finally(restore);
};

test('Claude Code: session 2 runs without --resume in the same workspace, sees the saved file, and the cost is summed over the two conversations', async () => {
  const root = tmp();
  try {
    const bench = makeBench(path.join(root, 'bench'));
    const task = freshTask(bench);
    const b = base(root);
    const tmpBase = path.join(root, 'faketmp');
    fs.mkdirSync(tmpBase);
    const one = streamWithId(b.probe, 'turn-1.jsonl', '11111111-1111-4111-8111-111111111111');
    const two = streamWithId(b.probe, 'turn-2.jsonl', '22222222-2222-4222-8222-222222222222');
    const bin = makeFakeClaude(path.join(root, 'tools'), { dir: b.probe, streamFile: one.file, turnStreams: [one.file, two.file], tmpBases: [tmpBase], probeFiles: [MEMORY], turnFiles: [{ [MEMORY]: 'use seconds' }] });
    const ctx = {
      config: { model: MODEL, canonicalModel: 'claude-sonnet-5-5', effort: 'high' }, scratchDir: b.scratchDir, claude: cc.resolveClaude({ binOverride: bin }), claudeTmpBases: [tmpBase], envKeep: [],
      envInfo: { kiroCliVersion: null, harnessVersion: '9.9.9', modelListSnapshotPath: null, region: 'us-east-1' }, isolation: { mode: 'none' }, runBudgetUsd: 0.75, tripwire: b.tripwire,
    };
    const r = await withCreds(() => executeRun({ arm: CC_ARM, task, replicate: 1, ctx, prepared: null, outDir: b.outDir, inFlightAtStart: 0 }));
    assert.equal(r.status, 'success', r.error);
    assert.deepEqual(validateResult(r), []);
    const [t1, t2] = [1, 2].map(b.turn);
    assert.equal(t1.stdin, task.prompt);
    assert.equal(t2.stdin, SECOND);
    assert.equal(t2.args.includes('--resume'), false);
    assert.deepEqual(t2.args, t1.args);
    assert.equal(t2.cwd, t1.cwd);
    assert.deepEqual(t2.seen, [MEMORY]);
    assert.deepEqual(r.sessions.map((x) => x.sessionId), ['11111111-1111-4111-8111-111111111111', '22222222-2222-4222-8222-222222222222']);
    assert.ok(Math.abs(r.costUsd - (one.cost + two.cost)) < 1e-9, `cost ${r.costUsd} is the sum of both conversations`);
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});
