// SPDX-License-Identifier: Apache-2.0
'use strict';

// Multi-turn runs against a fake kiro-cli: the agent asks, the scripted user answers, the session resumes.
// No credits, no network. Every spawned process uses a scratch HOME inside the test directory.

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { tmp, write, makeBench } = require('./helpers.js');
const { makeFakeKiro } = require('./fake-kiro.js');
const { executeRun } = require('../lib/run-one.js');
const { loadTasks } = require('../lib/tasks.js');
const { parseStream } = require('../lib/stream.js');
const { validateResult } = require('../lib/result.js');
const { CAP_MESSAGE, DEFAULT_ANSWER } = require('../lib/autonomy.js');

const ARM = { id: 'vanilla', label: 'vanilla', ref: null, commitSha: null, harness: 'none', agent: null, vanilla: true };
const CONFIG = { model: 'claude-sonnet-5.5', effort: 'high', agentEngine: 'v2' };
const AUTONOMY = {
  clarifications: [
    { id: 'unit', topic: 'unit', keywords: ['seconds?', 'milliseconds?'], answer: 'Seconds.' },
    { id: 'scope', topic: 'scope', keywords: ['per (user|account)'], answer: 'Per account.' },
  ],
};
const ASK_UNIT = 'I found the timeout setting.\n\nShould the timeout be in seconds or milliseconds?';

function setup(cfg, { autonomy = AUTONOMY, timeoutSec = 60 } = {}) {
  const root = tmp();
  const bench = makeBench(path.join(root, 'bench'));
  if (autonomy) {
    const t = JSON.parse(fs.readFileSync(path.join(bench, 'tasks/t1.json'), 'utf8'));
    write(path.join(bench, 'tasks/t1.json'), JSON.stringify({ ...t, class: 'autonomy', tiers: ['autonomy'], timeoutSec, autonomy }));
  }
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
    config: CONFIG, scratchDir, authDb, envKeep: [], envInfo: { kiroCliVersion: 'fake', modelListSnapshotPath: null },
    isolation: { mode: 'none' },
    tripwire: { roots: [{ dir: watch, depth: 2 }], extraExcludes: [], absExclude: [scratchDir, path.join(root, 'out')] },
  };
  const task = loadTasks(bench).get('t1');
  const prevPath = process.env.PATH;
  process.env.PATH = `${bin}${path.delimiter}${prevPath}`;
  const cleanup = () => { process.env.PATH = prevPath; fs.rmSync(root, { recursive: true, force: true }); };
  const turn = (n) => JSON.parse(fs.readFileSync(path.join(probe, `started-${n}.json`), 'utf8'));
  return { root, ctx, task, probe, scratchDir, outDir: path.join(root, 'out', 't1'), turn, cleanup };
}

const run = (s) => executeRun({ arm: ARM, task: s.task, replicate: 1, ctx: s.ctx, prepared: null, outDir: s.outDir, inFlightAtStart: 0 });
const read = (s, f) => fs.readFileSync(path.join(s.outDir, f), 'utf8');
const lastArg = (t) => t.args[t.args.length - 1];

test('the agent asks on turn 1, the scripted user answers, the same session resumes and the run ends on turn 2', async () => {
  const s = setup({ turns: [{ finalText: ASK_UNIT, credits: 1 }, { finalText: 'Done. I assumed seconds.', credits: 2 }] });
  try {
    const r = await run(s);
    assert.equal(r.status, 'success', r.error);
    assert.deepEqual(validateResult(r), []);
    assert.equal(r.turns, 2);
    assert.equal(r.interjections, 1);
    assert.equal(r.askedFirstTurn, true);
    assert.equal(r.autonomous, false);
    assert.equal(r.questionsAsked, 1);
    assert.equal(r.unmatchedQuestions, 0);
    assert.deepEqual(r.questions, [{ turn: 1, text: 'Should the timeout be in seconds or milliseconds?', matched: ['unit'], answered: true, reply: 'Seconds.' }]);
    assert.equal(r.finalText, 'Done. I assumed seconds.');
    assert.equal(r.askedUser, false);
    assert.equal(r.assumptionsStated, true);
    const t1 = s.turn(1);
    const t2 = s.turn(2);
    assert.equal(t1.args.includes('--resume-id'), false);
    assert.equal(t2.args[t2.args.indexOf('--resume-id') + 1], 's1', 'resumes the session id read from turn 1');
    assert.equal(lastArg(t2), 'Seconds.', 'the reply is the new input');
    assert.equal(t2.cwd, t1.cwd);
    assert.equal(t2.home, t1.home);
    assert.ok(t1.home.startsWith(s.scratchDir), 'the agent ran with the scratch HOME, never the real one');
    for (const flag of ['--no-interactive', '--trust-all-tools', '--model', '--effort', '--output-format']) assert.ok(t2.args.includes(flag), flag);
  } finally { s.cleanup(); }
});

test('credits, model calls, tool calls and wall clock are summed over the turns', async () => {
  const calls = [{ toolName: 'shell', rawInput: {} }, { toolName: 'subagent', rawInput: {} }];
  const s = setup({ toolCalls: calls, turns: [{ finalText: ASK_UNIT, credits: 1.25, delayMs: 400 }, { finalText: 'Done.', credits: 2.5, delayMs: 400 }] });
  try {
    const r = await run(s);
    assert.equal(r.credits, 3.75);
    assert.equal(r.modelCalls.meteringEntries, 2);
    assert.equal(r.modelCalls.totalRequestCount, 2);
    assert.equal(r.toolCalls, 4, 'tool call ids repeat across turns and are still counted');
    assert.equal(r.subagentCalls, 2);
    assert.equal(r.workToolCalls, 2);
    assert.ok(r.wallClockMs >= 800, `wall clock ${r.wallClockMs} covers both turns`);
    assert.equal(r.creditsCensored, false);
    assert.equal(r.flags.includes('creditsMismatch'), false, 'the session files agree with the summed stream credits');
    assert.equal(r.creditsSessionTotal, 3.75);
  } finally { s.cleanup(); }
});

test('each turn keeps its own stream and the concatenation is stream.jsonl', async () => {
  const s = setup({ turns: [{ finalText: ASK_UNIT }, { finalText: 'Done.' }] });
  try {
    await run(s);
    const one = read(s, 'stream-1.jsonl');
    const two = read(s, 'stream-2.jsonl');
    assert.match(one, /seconds or milliseconds/);
    assert.match(two, /Done\./);
    assert.equal(read(s, 'stream.jsonl'), one + two);
    const finals = parseStream(read(s, 'stream.jsonl')).events.filter((e) => e.type === 'runFinished');
    assert.equal(finals.length, 2);
    assert.ok(fs.existsSync(path.join(s.outDir, 'stderr-1.txt')));
    assert.ok(fs.existsSync(path.join(s.outDir, 'stderr.txt')));
    assert.match(read(s, 'command.txt'), /turn 2/);
  } finally { s.cleanup(); }
});

test('a run that never asks is one turn and needs no help', async () => {
  const s = setup({ finalText: 'Done. Assumptions: seconds.' });
  try {
    const r = await run(s);
    assert.equal(r.turns, 1);
    assert.equal(r.interjections, 0);
    assert.equal(r.askedFirstTurn, false);
    assert.equal(r.autonomous, true);
    assert.deepEqual(r.questions, []);
    assert.equal(fs.existsSync(path.join(s.probe, 'started-2.json')), false);
  } finally { s.cleanup(); }
});

test('a question with no matching clarification gets the default answer and counts as unmatched', async () => {
  const s = setup({ turns: [{ finalText: 'Do you want a changelog entry?' }, { finalText: 'Done.' }] });
  try {
    const r = await run(s);
    assert.equal(lastArg(s.turn(2)), DEFAULT_ANSWER);
    assert.equal(r.unmatchedQuestions, 1);
    assert.equal(r.interjections, 1);
    assert.deepEqual(r.questions[0].matched, []);
  } finally { s.cleanup(); }
});

test('two matches in one question give one numbered reply', async () => {
  const s = setup({ turns: [{ finalText: 'Is the limit per user or per account, and is the timeout in seconds?' }, { finalText: 'Done.' }] });
  try {
    const r = await run(s);
    assert.equal(lastArg(s.turn(2)), '1. Seconds.\n2. Per account.');
    assert.deepEqual(r.questions[0].matched, ['unit', 'scope']);
    assert.equal(r.interjections, 1);
  } finally { s.cleanup(); }
});

test('the interjection cap sends the proceed message once and the run ends when the agent asks again', async () => {
  const autonomy = { ...AUTONOMY, maxInterjections: 1 };
  const s = setup({ turns: [{ finalText: ASK_UNIT }, { finalText: 'And per user or per account?' }, { finalText: 'Still unsure, which one?' }, { finalText: 'never reached' }] }, { autonomy });
  try {
    const r = await run(s);
    assert.equal(r.turns, 3);
    assert.equal(r.interjections, 1);
    assert.equal(r.interjectionCapHit, true);
    assert.equal(lastArg(s.turn(3)), CAP_MESSAGE);
    assert.equal(fs.existsSync(path.join(s.probe, 'started-4.json')), false, 'no reply after the proceed message');
    assert.equal(r.questionsAsked, 3);
    assert.deepEqual(r.questions.map((q) => q.answered), [true, true, false]);
    assert.equal(r.autonomous, false);
    assert.equal(r.askedUser, true, 'the last message is still a question');
  } finally { s.cleanup(); }
});

test('a non end_turn stop reason is treated as an ask and answered with the default', async () => {
  const s = setup({ turns: [{ finalText: 'partial', stopReason: 'max_tokens' }, { finalText: 'Done.' }] });
  try {
    const r = await run(s);
    assert.equal(r.turns, 2);
    assert.match(r.questions[0].text, /^partial/);
    assert.equal(lastArg(s.turn(2)), DEFAULT_ANSWER);
  } finally { s.cleanup(); }
});

test('the task timeout covers all turns together and a timeout in a later turn ends the run as a timeout', async () => {
  const s = setup({ turns: [{ finalText: ASK_UNIT, delayMs: 1200 }, { sleepSec: 30 }] }, { timeoutSec: 2 });
  try {
    const r = await run(s);
    assert.equal(r.status, 'timeout');
    assert.equal(r.turns, 2);
    assert.equal(r.creditsCensored, true);
    assert.ok(r.wallClockMs < 2800, `wall clock ${r.wallClockMs} ms shows one 2 s budget, not 2 s per turn`);
    assert.ok(r.wallClockMs >= 1900);
    const pid = s.turn(2).pid;
    assert.throws(() => process.kill(pid, 0), /ESRCH/, 'the killed turn left no process behind');
    assert.deepEqual(fs.readdirSync(s.scratchDir), []);
  } finally { s.cleanup(); }
});

test('a turn that exits non-zero ends the run without resuming', async () => {
  const s = setup({ turns: [{ exitCode: 3 }, { finalText: 'never' }] });
  try {
    const r = await run(s);
    assert.equal(r.status, 'error');
    assert.equal(r.turns, 1);
    assert.equal(fs.existsSync(path.join(s.probe, 'started-2.json')), false);
  } finally { s.cleanup(); }
});

test('the session model is checked across all turns', async () => {
  const s = setup({ turns: [{ finalText: ASK_UNIT }, { finalText: 'Done.', model: 'claude-haiku-5' }] });
  try {
    const r = await run(s);
    assert.ok(r.flags.includes('modelMismatch'));
    assert.equal(r.status, 'error');
    assert.match(r.error, /claude-haiku-5/);
  } finally { s.cleanup(); }
});

test('the credential copy is there for every turn and gone afterwards', async () => {
  const s = setup({ turns: [{ finalText: ASK_UNIT }, { finalText: 'Another?' }, { finalText: 'Done.' }] }, { autonomy: { ...AUTONOMY, maxInterjections: 3 } });
  try {
    await run(s);
    assert.deepEqual([1, 2, 3].map((n) => s.turn(n).authPresent), [true, true, true]);
    assert.deepEqual(fs.readdirSync(s.scratchDir), []);
    const leftovers = fs.readdirSync(s.root, { recursive: true }).filter((f) => path.basename(String(f)) === 'data.sqlite3' && String(f).includes('scratch'));
    assert.deepEqual(leftovers, []);
  } finally { s.cleanup(); }
});

test('every turn gets the same environment allowlist', async () => {
  const s = setup({ turns: [{ finalText: ASK_UNIT }, { finalText: 'Done.' }] });
  try {
    await run(s);
    assert.deepEqual(s.turn(2).envKeys.sort(), s.turn(1).envKeys.sort());
    assert.equal(s.turn(2).envKeys.includes('GITHUB_TOKEN'), false);
  } finally { s.cleanup(); }
});

test('a task without an autonomy block stays a single turn even when the agent asks', async () => {
  const s = setup({ finalText: 'Which file should I change?' }, { autonomy: null });
  try {
    const r = await run(s);
    assert.equal(r.askedUser, true);
    assert.equal('turns' in r, false);
    assert.equal(fs.existsSync(path.join(s.outDir, 'stream-1.jsonl')), false);
    assert.equal(fs.existsSync(path.join(s.probe, 'started-2.json')), false);
  } finally { s.cleanup(); }
});

test('hidden test groups run on the final workspace of a resumed run', async () => {
  const s = setup({ turns: [{ finalText: ASK_UNIT }, { finalText: 'Done.' }] });
  try {
    const bench = path.join(s.root, 'bench');
    write(path.join(bench, 'tasks/hidden/h1/intended/a.test.js'), "require('node:test')('x', () => require('node:assert').ok(require('fs').existsSync('out.txt')));\n");
    write(path.join(bench, 'tasks/hidden/h1/invariants/b.test.js'), "require('node:test')('y', () => {});\n");
    const t = JSON.parse(fs.readFileSync(path.join(bench, 'tasks/t1.json'), 'utf8'));
    write(path.join(bench, 'tasks/t1.json'), JSON.stringify({
      ...t, hidden: 'h1',
      checks: [{ type: 'tests', cmd: 'node --test intended/*.test.js', min: 1, group: 'intended' }, { type: 'tests', cmd: 'node --test invariants/*.test.js', min: 1, group: 'invariant' }],
    }));
    s.task = loadTasks(bench).get('t1');
    const r = await run(s);
    assert.deepEqual(r.intendedTests, { passed: 1, total: 1, unparsed: false });
    assert.deepEqual(r.invariantTests, { passed: 1, total: 1, unparsed: false });
    assert.equal(r.completedWithoutHelp, false, 'it needed one interjection');
  } finally { s.cleanup(); }
});

test('kiroArgs adds --resume-id before the reply, or --resume when no session id was read', () => {
  const { kiroArgs } = require('../lib/run-one.js');
  const a = kiroArgs({ arm: { agent: 'konductor', vanilla: false }, task: { prompt: 'first' }, config: CONFIG, resume: { sessionId: 'abc', prompt: 'Seconds.' } });
  assert.deepEqual(a.slice(-3), ['--resume-id', 'abc', 'Seconds.']);
  assert.equal(a.includes('first'), false);
  assert.ok(a.includes('--require-mcp-startup') && a.includes('--agent'));
  const b = kiroArgs({ arm: { agent: null, vanilla: true }, task: { prompt: 'first' }, config: CONFIG, resume: { sessionId: null, prompt: 'go' } });
  assert.deepEqual(b.slice(-2), ['--resume', 'go']);
  assert.equal(kiroArgs({ arm: { agent: null, vanilla: true }, task: { prompt: 'first' }, config: CONFIG }).at(-1), 'first');
});
