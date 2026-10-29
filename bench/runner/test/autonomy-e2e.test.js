// SPDX-License-Identifier: Apache-2.0
'use strict';

// A shipped autonomy task end to end with a fake kiro-cli that writes the reference solution on its last turn:
// real fixture, real hidden tests, real scripted answers, then the report. No model call.

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { tmp, write } = require('./helpers.js');
const { makeFakeKiro } = require('./fake-kiro.js');
const { executeRun } = require('../lib/run-one.js');
const { loadTasks, BENCH_DIR } = require('../lib/tasks.js');
const { validateResult } = require('../lib/result.js');
const { loadRun } = require('../../report/load.js');
const { buildReport } = require('../../report/aggregate.js');
const { renderMarkdown } = require('../../report/render.js');

const ARM = { id: 'vanilla', label: 'vanilla', ref: null, commitSha: null, harness: 'none', agent: null, vanilla: true };

function filesOf(dir, base = dir) {
  const out = {};
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) Object.assign(out, filesOf(p, base));
    else out[path.relative(base, p)] = fs.readFileSync(p, 'utf8');
  }
  return out;
}

async function runShipped(taskId, turns) {
  const root = tmp();
  const bin = path.join(root, 'bin');
  const probe = path.join(root, 'probe');
  fs.mkdirSync(probe);
  makeFakeKiro(bin, { dir: probe, sessionJson: true, turns });
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
  try {
    const task = loadTasks(BENCH_DIR).get(taskId);
    const outDir = path.join(root, 'run', 'vanilla', taskId, '1');
    const result = await executeRun({ arm: ARM, task, replicate: 1, ctx, prepared: null, outDir, inFlightAtStart: 0 });
    write(path.join(root, 'run', 'run-config.json'), JSON.stringify({ suite: 'autonomy', model: 'claude-sonnet-5.5', effort: 'high', taskIds: [taskId] }));
    return { result, task, root, probe, runDir: path.join(root, 'run'), done: () => { process.env.PATH = prevPath; fs.rmSync(root, { recursive: true, force: true }); } };
  } catch (e) {
    process.env.PATH = prevPath;
    throw e;
  }
}

test('gateway task: one question answered from three clarifications, reference solution written, all hidden tests pass', async () => {
  const id = 'autonomy-gateway-throttle';
  const solution = filesOf(path.join(BENCH_DIR, 'tasks', 'solutions', id));
  const s = await runShipped(id, [
    { finalText: 'I read the gateway.\n\nBefore I add rate limiting I need three things:\n\n1. How many requests per minute should a client get?\n2. Should the limit apply per user or per IP address?\n3. What response should a limited caller see (status, Retry-After)?' },
    { finalText: 'Done. I used 100 requests per minute per user, per IP for anonymous callers, and a 429 with retryAfterSec. Assumptions: fixed windows.', files: solution },
  ]);
  try {
    const r = s.result;
    assert.equal(r.status, 'success', r.error);
    assert.deepEqual(validateResult(r), []);
    assert.equal(r.turns, 2);
    assert.equal(r.interjections, 1);
    assert.deepEqual(r.questions[0].matched, ['limit', 'scope', 'response']);
    const reply = fs.readFileSync(path.join(s.probe, 'started-2.json'), 'utf8');
    assert.match(JSON.parse(reply).args.at(-1), /^1\. 100 requests per minute\.\n2\. Count per authenticated user.*\n3\. Refuse with status 429/s);
    assert.deepEqual(r.intendedTests, { passed: 7, total: 7, unparsed: false });
    assert.deepEqual(r.invariantTests, { passed: 6, total: 6, unparsed: false });
    assert.equal(r.checks.every((c) => c.passed), true, JSON.stringify(r.checks.filter((c) => !c.passed)));
    assert.equal(r.autonomous, false);
    assert.equal(r.completedWithoutHelp, false);
    assert.equal(r.assumptionsStated, true);

    const { report } = buildReport({ run: loadRun(s.runDir), tasks: loadTasks(BENCH_DIR), baseline: 'vanilla' });
    const a = report.arms.vanilla.autonomy.autonomy;
    assert.equal(a.runs, 1);
    assert.equal(a.askedRate, 1);
    assert.equal(a.intended.allPassShare, 1);
    assert.equal(a.interjectionsPerSuccess, 1);
    assert.match(renderMarkdown(report), /## Autonomy[\s\S]*\| vanilla \| 1 \|/);
  } finally { s.done(); }
});

test('no-question task: asking anyway gets the neutral reply and shows up as an unnecessary question', async () => {
  const id = 'autonomy-format-bytes';
  const solution = filesOf(path.join(BENCH_DIR, 'tasks', 'solutions', id));
  const s = await runShipped(id, [
    { finalText: 'Should KB mean 1000 or 1024 bytes?' },
    { finalText: 'Done.', files: solution },
  ]);
  try {
    const r = s.result;
    assert.equal(r.status, 'success', r.error);
    assert.equal(r.interjections, 1);
    assert.equal(r.unmatchedQuestions, 1);
    assert.deepEqual(r.intendedTests, { passed: 8, total: 8, unparsed: false });
    assert.equal(r.completedWithoutHelp, false);
    const { report } = buildReport({ run: loadRun(s.runDir), tasks: loadTasks(BENCH_DIR), baseline: 'vanilla' });
    const a = report.arms.vanilla.autonomy.autonomy;
    assert.deepEqual(a.noQuestionTasks, { runs: 1, askedRuns: 1, questions: 1 });
    assert.equal(a.unmatchedQuestions, 0, 'a question on a no-question task is counted there, not as unmatched');
  } finally { s.done(); }
});

test('guessing wrong is measurable: a partial solution written without asking scores below the reference and keeps the invariants', async () => {
  const id = 'autonomy-gateway-throttle';
  const partial = filesOf(path.join(BENCH_DIR, 'tasks', 'partials', id, 'per-ip-60'));
  const s = await runShipped(id, [{ finalText: 'Done. I limited each address to 60 requests per minute.', files: partial }]);
  try {
    const r = s.result;
    assert.equal(r.turns, 1);
    assert.equal(r.autonomous, true);
    assert.ok(r.intendedTests.passed < r.intendedTests.total);
    assert.deepEqual(r.invariantTests, { passed: 6, total: 6, unparsed: false });
    assert.equal(r.completedWithoutHelp, false);
  } finally { s.done(); }
});
