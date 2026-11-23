// SPDX-License-Identifier: Apache-2.0
'use strict';

const { NO_GIT_NOTE } = require('../lib/run-one.js');
const noGit = (p) => `${p}\n\n${NO_GIT_NOTE}`; // a git-less fixture's prompt ends with the runner's note (D-161)

// The scripted user of `questions: scripted` tasks (schema v3): the harness answers the agent's questions from
// task.scriptedUser and resumes the session, on Kiro CLI and Claude Code, against fake agents. No credits, no network.

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
const { scriptedToAutonomy, newConversation } = require('../lib/autonomy.js');
const { v3Errors } = require('../lib/task-v3.js');
const cc = require('../../plugins/claude-code/harness.js');

const FX = path.join(__dirname, 'fixtures', 'claude-code');
const SCRIPTED = {
  facts: [
    { id: 'budget', topics: ['budget', 'how much'], answer: 'The budget is 12k a month.' },
    { id: 'deadline', topics: ['deadline', 'launch date'], answer: 'We launch on 3 March.' },
    { id: 'never', topics: ['compliance'], answer: 'SOC 2 applies.' },
  ],
  defaultReply: 'No preference. Use your judgment.',
};
const ASK_BUDGET = 'I have read the brief.\n\nWhat is the budget for this?';
const ASK_OTHER = 'Which colour should the badge be?';
const DONE = 'Done. I wrote the requirements.';

// ---- the mapping ----

test('scriptedToAutonomy turns facts into clarifications, matches topics as plain substrings and gives each fact once', () => {
  const a = scriptedToAutonomy({ facts: [{ id: 'f1', topics: ['budget (usd)', 'cost'], answer: 'ten' }, { id: 'f2', topics: ['a.c'], answer: 'two' }], defaultReply: 'Whatever.' });
  assert.equal(a.scripted, true);
  assert.equal(a.defaultAnswer, 'Whatever.');
  assert.equal(a.maxInterjections, 4);
  const conv = newConversation(a);
  const ask = (text) => conv.record({ askedUser: true, finalText: text, stopReason: 'end_turn' });
  assert.equal(ask('What is the Budget (USD)?').text, 'ten', 'case-insensitive, parentheses are not a pattern');
  assert.equal(ask('And the cost again?').kind, 'default', 'a fact is given once');
  assert.equal(ask('Is it abc?').kind, 'default', '"a.c" is not a pattern: the dot matches only a dot');
  assert.equal(ask('Does it use a.c?').text, 'two');
  assert.deepEqual([...conv.oracle.state.answered].sort(), ['f1', 'f2']);
  assert.equal(scriptedToAutonomy({ facts: new Array(9).fill(0).map((_, i) => ({ id: `f${i}`, topics: ['x'], answer: 'y' })), defaultReply: 'z' }).maxInterjections, 11, 'room for one question per fact and two more');
});

test('a scripted task gets its autonomy block when the tasks load; a task with both scriptedUser and autonomy is refused', () => {
  const root = tmp();
  const bench = makeBench(path.join(root, 'bench'));
  const t = JSON.parse(fs.readFileSync(path.join(bench, 'tasks/t1.json'), 'utf8'));
  write(path.join(bench, 'tasks/t1.json'), JSON.stringify({ ...t, questions: 'scripted', scriptedUser: SCRIPTED }));
  const loaded = loadTasks(bench).get('t1');
  assert.equal(loaded.autonomy.scripted, true);
  assert.deepEqual(loaded.autonomy.clarifications.map((c) => c.id), ['budget', 'deadline', 'never']);
  assert.deepEqual(v3Errors({ ...t, questions: 'scripted', scriptedUser: SCRIPTED, autonomy: { clarifications: [] } }).filter((e) => /cannot both/.test(e)).length, 1);
  write(path.join(bench, 'tasks/t1.json'), JSON.stringify({ ...t, questions: 'allowed' }));
  assert.equal(loadTasks(bench).get('t1').autonomy, undefined, 'an ordinary task stays one turn');
});

// ---- Kiro CLI ----

const ARM = { id: 'vanilla', label: 'vanilla', ref: null, commitSha: null, harness: 'none', agent: null, vanilla: true };

function scriptedTask(bench) {
  const t = JSON.parse(fs.readFileSync(path.join(bench, 'tasks/t1.json'), 'utf8'));
  write(path.join(bench, 'tasks/t1.json'), JSON.stringify({ ...t, class: 'simple', questions: 'scripted', scriptedUser: SCRIPTED, timeoutSec: 60 }));
  return loadTasks(bench).get('t1');
}

function kiroSetup(cfg) {
  const root = tmp();
  const bench = makeBench(path.join(root, 'bench'));
  const task = scriptedTask(bench);
  const bin = path.join(root, 'bin');
  const probe = path.join(root, 'probe');
  fs.mkdirSync(probe);
  makeFakeKiro(bin, { dir: probe, sessionJson: true, ...cfg });
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
  const prevPath = process.env.PATH;
  process.env.PATH = `${bin}${path.delimiter}${prevPath}`;
  const turn = (n) => JSON.parse(fs.readFileSync(path.join(probe, `started-${n}.json`), 'utf8'));
  return { ctx, task, outDir: path.join(root, 'out', 't1'), turn, cleanup: () => { process.env.PATH = prevPath; fs.rmSync(root, { recursive: true, force: true }); } };
}

test('Kiro CLI: the agent asks twice, each question gets its fact or the default, and the result lists the questions and the facts', async () => {
  const s = kiroSetup({ turns: [{ finalText: ASK_BUDGET, credits: 1 }, { finalText: ASK_OTHER, credits: 1 }, { finalText: DONE, credits: 1 }] });
  try {
    const r = await executeRun({ arm: ARM, task: s.task, replicate: 1, ctx: s.ctx, prepared: null, outDir: s.outDir, inFlightAtStart: 0 });
    assert.equal(r.status, 'success', r.error);
    assert.deepEqual(validateResult(r), []);
    assert.equal(r.turns, 3);
    assert.deepEqual(r.questions.map((q) => [q.turn, q.matched, q.reply]), [[1, ['budget'], 'The budget is 12k a month.'], [2, [], 'No preference. Use your judgment.']]);
    assert.deepEqual(r.factsUnlocked, ['budget']);
    assert.deepEqual(r.factsLocked, ['deadline', 'never']);
    assert.equal(r.unmatchedQuestions, 1);
    assert.equal(r.autonomous, null, 'questions are expected, so "autonomous" does not apply');
    assert.equal(r.completedWithoutHelp, null);
    const t2 = s.turn(2);
    assert.equal(t2.args[t2.args.indexOf('--resume-id') + 1], 's1');
    assert.equal(t2.args[t2.args.length - 1], 'The budget is 12k a month.');
    assert.equal(s.turn(3).args[s.turn(3).args.length - 1], 'No preference. Use your judgment.');
  } finally { s.cleanup(); }
});

test('Kiro CLI: checks of a scripted task read the conversation from BENCH_CONVERSATION', async () => {
  const s = kiroSetup({ turns: [{ finalText: ASK_BUDGET, credits: 1 }, { finalText: DONE, credits: 1 }] });
  try {
    const probe = "const c=JSON.parse(require('fs').readFileSync(process.env.BENCH_CONVERSATION,'utf8'));process.exit(c.questions.length===1&&c.questions[0].matched[0]==='budget'&&c.questions[0].count>=1?0:1)";
    const task = { ...s.task, checks: [{ type: 'cmd', cmd: `node -e "${probe}"` }] };
    const r = await executeRun({ arm: ARM, task, replicate: 1, ctx: s.ctx, prepared: null, outDir: s.outDir, inFlightAtStart: 0 });
    assert.equal(r.status, 'success', r.error);
    assert.equal(r.checks[0].passed, true, r.checks[0].detail);
  } finally { s.cleanup(); }
});

test('Kiro CLI: checks read the final message from BENCH_FINAL_TEXT, a file outside the workspace (D-65)', async () => {
  const s = kiroSetup({ turns: [{ finalText: DONE, credits: 1 }] });
  try {
    const probe = "const f=process.env.BENCH_FINAL_TEXT;process.exit(f&&!require('path').resolve(f).startsWith(process.cwd())&&require('fs').readFileSync(f,'utf8')===process.argv[1]?0:1)";
    const task = { ...s.task, checks: [{ type: 'cmd', cmd: `node -e "${probe}" '${DONE.replace(/'/g, "'\\''")}'` }] };
    const r = await executeRun({ arm: ARM, task, replicate: 1, ctx: s.ctx, prepared: null, outDir: s.outDir, inFlightAtStart: 0 });
    assert.equal(r.status, 'success', r.error);
    assert.equal(r.checks[0].passed, true, r.checks[0].detail);
  } finally { s.cleanup(); }
});

test('Kiro CLI: an agent that never asks is one turn and every fact stays locked', async () => {
  const s = kiroSetup({ turns: [{ finalText: DONE, credits: 1 }] });
  try {
    const r = await executeRun({ arm: ARM, task: s.task, replicate: 1, ctx: s.ctx, prepared: null, outDir: s.outDir, inFlightAtStart: 0 });
    assert.equal(r.turns, 1);
    assert.deepEqual([r.factsUnlocked, r.factsLocked, r.questionsAsked], [[], ['budget', 'deadline', 'never'], 0]);
    assert.deepEqual(validateResult(r), []);
  } finally { s.cleanup(); }
});

// ---- Claude Code ----

// A recorded one-turn stream with its session id and final text replaced.
function streamFile(dir, name, sessionId, text) {
  const lines = fs.readFileSync(path.join(FX, 'vanilla-success.stream.jsonl'), 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l));
  for (const ev of lines) {
    if (ev.session_id) ev.session_id = sessionId;
    if (ev.type === 'assistant') for (const b of ev.message.content) if (b.type === 'text') b.text = text;
    if (typeof ev.result === 'string') ev.result = text;
  }
  const file = path.join(dir, name);
  fs.writeFileSync(file, `${lines.map((l) => JSON.stringify(l)).join('\n')}\n`);
  return file;
}

const CC_ARM = { id: 'cc-vanilla', label: 'cc-vanilla', ref: null, commitSha: null, harness: 'claude-code', agent: null, vanilla: true };
const MODEL = 'us.anthropic.claude-sonnet-5-5';

function claudeSetup(texts) {
  const root = tmp();
  const bench = makeBench(path.join(root, 'bench'));
  const task = scriptedTask(bench);
  const probe = path.join(root, 'probe');
  fs.mkdirSync(probe);
  const tmpBase = path.join(root, 'faketmp');
  fs.mkdirSync(tmpBase);
  const turnStreams = texts.map((t, i) => streamFile(probe, `turn-${i + 1}.jsonl`, '445ddd25-adc6-4c3f-addf-d373844db85d', t));
  const bin = makeFakeClaude(path.join(root, 'tools'), { dir: probe, streamFile: turnStreams[0], turnStreams, tmpBases: [tmpBase] });
  const scratchDir = path.join(root, 'scratch');
  fs.mkdirSync(scratchDir);
  const watch = path.join(root, 'watch');
  fs.mkdirSync(watch);
  const ctx = {
    config: { model: MODEL, canonicalModel: 'claude-sonnet-5-5', effort: 'high' }, scratchDir, claude: cc.resolveClaude({ binOverride: bin }), claudeTmpBases: [tmpBase], envKeep: [],
    envInfo: { kiroCliVersion: null, harnessVersion: '9.9.9', modelListSnapshotPath: null, region: 'us-east-1' }, isolation: { mode: 'none' }, runBudgetUsd: 0.75,
    tripwire: { roots: [{ dir: watch, depth: 2 }], extraExcludes: [], absExclude: [scratchDir, path.join(root, 'out')] },
  };
  const turn = (n) => JSON.parse(fs.readFileSync(path.join(probe, `started-${n}.json`), 'utf8'));
  return { ctx, task, outDir: path.join(root, 'out', 't1'), turn, cleanup: () => fs.rmSync(root, { recursive: true, force: true }) };
}

const withCreds = (fn) => {
  const keep = { id: process.env.AWS_ACCESS_KEY_ID, secret: process.env.AWS_SECRET_ACCESS_KEY, token: process.env.AWS_SESSION_TOKEN };
  Object.assign(process.env, { AWS_ACCESS_KEY_ID: 'AKIAFAKEFAKEFAKE0001', AWS_SECRET_ACCESS_KEY: 'fake/secret/key/for/the/test/only/0000000', AWS_SESSION_TOKEN: 'faketoken0123456789' });
  const restore = () => { for (const [k, v] of [['AWS_ACCESS_KEY_ID', keep.id], ['AWS_SECRET_ACCESS_KEY', keep.secret], ['AWS_SESSION_TOKEN', keep.token]]) { if (v === undefined) delete process.env[k]; else process.env[k] = v; } };
  return fn().finally(restore);
};

test('Claude Code: the session resumes with --resume and the scripted answer on stdin, and the result lists the questions and facts', async () => {
  const s = claudeSetup([ASK_BUDGET, ASK_OTHER, DONE]);
  try {
    const r = await withCreds(() => executeRun({ arm: CC_ARM, task: s.task, replicate: 1, ctx: s.ctx, prepared: null, outDir: s.outDir, inFlightAtStart: 0 }));
    assert.equal(r.status, 'success', r.error);
    assert.deepEqual(validateResult(r), []);
    assert.equal(r.turns, 3);
    assert.deepEqual(r.questions.map((q) => [q.turn, q.matched]), [[1, ['budget']], [2, []]]);
    assert.deepEqual(r.factsUnlocked, ['budget']);
    assert.deepEqual(r.factsLocked, ['deadline', 'never']);
    const [t1, t2, t3] = [1, 2, 3].map(s.turn);
    assert.equal(t1.args.includes('--resume'), false);
    assert.equal(t1.stdin, noGit(s.task.prompt));
    assert.equal(t2.args[t2.args.indexOf('--resume') + 1], '445ddd25-adc6-4c3f-addf-d373844db85d', 'the session id read from turn 1');
    assert.equal(t2.stdin, 'The budget is 12k a month.', 'the reply is the prompt, on stdin and not in argv');
    assert.equal(t3.stdin, 'No preference. Use your judgment.');
    assert.equal(t2.args.some((a) => a.includes('12k')), false);
    // The same model, effort, tools and permission mode as the first turn: only the resume pair is added.
    assert.deepEqual(t2.args.filter((a, i) => !(a === '--resume' || t2.args[i - 1] === '--resume')), t1.args);
    assert.equal(t2.cwd, t1.cwd);
    assert.equal(t2.home, t1.home);
    for (const n of [1, 2, 3]) assert.ok(fs.existsSync(path.join(s.outDir, `stream-${n}.jsonl`)), `stream-${n}.jsonl`);
  } finally { s.cleanup(); }
});

test('Claude Code: buildCommand adds --resume SESSION and the reply on stdin, and refuses a resume with no session id', () => {
  const ctx = { claude: { bin: '/x/claude', supportsHookEvents: true }, runBudgetUsd: 1 };
  const config = { model: MODEL, effort: 'high' };
  const c = cc.buildCommand({ arm: CC_ARM, task: { prompt: 'p' }, config, ctx, resume: { sessionId: 'abc', prompt: 'the answer' } });
  assert.deepEqual(c.args.slice(0, 3), ['-p', '--resume', 'abc']);
  assert.equal(c.stdin, 'the answer');
  assert.throws(() => cc.buildCommand({ arm: CC_ARM, task: { prompt: 'p' }, config, ctx, resume: { prompt: 'x' } }), /no session id/);
});
