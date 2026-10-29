// SPDX-License-Identifier: Apache-2.0
'use strict';

// Builds a tiny bench dir and run dir on disk for judge and report tests.

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const RUBRIC = [
  { id: 'c1', criterion: 'Does the first thing.', weight: 1 },
  { id: 'c2', criterion: 'Does the second thing.', weight: 3 },
];

function tmp() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'benchtest-'));
}

function write(file, text) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, text);
}

function makeBench(root, { cls = 'simple', taskId = 't1' } = {}) {
  write(path.join(root, 'fixtures/fx/a.txt'), 'alpha\n');
  write(path.join(root, 'fixtures/fx/b.txt'), 'bravo\n');
  write(path.join(root, 'fixtures/fx/.bench-answer-key.md'), 'KEY: the seeded defect is in a.txt\n');
  const task = {
    id: taskId, class: cls, target: null, prompt: 'Fix the thing.', fixture: 'fx', timeoutSec: 60,
    checks: [{ type: 'file_exists', path: 'a.txt' }], rubric: RUBRIC, tiers: ['lite'],
  };
  write(path.join(root, `tasks/${taskId}.json`), JSON.stringify(task));
  return root;
}

function mkResult(o = {}) {
  return {
    armId: 'vanilla', armLabel: 'vanilla', ref: null, commitSha: null, harness: 'none',
    model: 'claude-sonnet-5.5', effort: 'high', taskId: 't1', replicate: 1, status: 'success',
    exitCode: 0, runFinishedStatus: 'success', wallClockMs: 1000, turnDurationMs: 900, credits: 1,
    modelCalls: { meteringEntries: 2, totalRequestCount: 2 }, toolCalls: 3, subagentCalls: 0,
    contextUsagePercentage: 1, transcriptBytes: 100, estTokens: { value: 100, isEstimate: true },
    checks: [{ type: 'file_exists', path: 'a.txt', passed: true }],
    kiroCliVersion: 'kiro-cli 2.35.1', modelListSnapshotPath: null, ...o,
  };
}

// specs: [{arm, task, rep, finalText, files, ...resultOverrides}]
function makeRun(runDir, benchDir, specs, config = {}) {
  for (const s of specs) {
    const { arm, task = 't1', rep = 1, finalText = 'done', files = {}, ...over } = s;
    const dir = path.join(runDir, arm, task, String(rep));
    write(path.join(dir, 'result.json'), JSON.stringify(mkResult({ armId: arm, armLabel: arm, taskId: task, replicate: rep, ...over })));
    const events = [
      { type: 'sessionUpdate', data: { update: { sessionUpdate: 'tool_call', toolCallId: 'x', _meta: { kiro: { toolName: 'subagent' } } } } },
      { type: 'runFinished', data: { status: 'success', finalText } },
    ];
    write(path.join(dir, 'stream.jsonl'), events.map((e) => JSON.stringify(e)).join('\n') + '\n');
    for (const f of ['a.txt', 'b.txt']) write(path.join(dir, 'workspace', f), fs.readFileSync(path.join(benchDir, 'fixtures/fx', f), 'utf8'));
    for (const [f, text] of Object.entries(files)) {
      if (text === null) fs.rmSync(path.join(dir, 'workspace', f), { force: true });
      else write(path.join(dir, 'workspace', f), text);
    }
  }
  write(path.join(runDir, 'run-config.json'), JSON.stringify({
    suite: 'lite', model: 'claude-sonnet-5.5', effort: 'high', taskIds: ['t1'], ...config,
  }));
  return runDir;
}

module.exports = { RUBRIC, tmp, write, makeBench, makeRun, mkResult };

function addTask(bench, id, cls) {
  const t = JSON.parse(fs.readFileSync(path.join(bench, 'tasks/t1.json'), 'utf8'));
  write(path.join(bench, `tasks/${id}.json`), JSON.stringify({ ...t, id, class: cls }));
}

// recs: [{judge, arm, task, rep, score, criteria?: {c1:'pass',...}, error?}]
function writeJudgments(runDir, { judges, rubric = [], pairwise = [] }) {
  const R = rubric.map((r) => ({
    kind: 'rubric', judge: r.judge, armId: r.arm, taskId: r.task || 't1', replicate: r.rep || 1,
    score: r.score ?? null, criteria: Object.entries(r.criteria || {}).map(([id, verdict]) => ({ id, verdict, evidence: 'e', evidenceFound: true })),
    judgeError: r.error ?? null, parseFailures: 0, calls: [{ credits: 0.1, latencyMs: 100, cached: false, ok: true }], redactionsFired: {},
  }));
  const P = pairwise.map((p) => ({
    kind: 'pairwise', judge: p.judge, armId: p.arm, baselineId: 'vanilla', taskId: p.task || 't1', replicate: p.rep || 1,
    verdict: p.verdict, positionInconsistent: Boolean(p.pi), orderings: [p.verdict, p.verdict], judgeError: p.error ?? null,
    parseFailures: 0, calls: [{ credits: 0.2, latencyMs: 200, cached: false, ok: true }], redactionsFired: {},
  }));
  write(path.join(runDir, 'judgments.json'), JSON.stringify({ schemaVersion: 1, baseline: 'vanilla', judges, modes: ['rubric', 'pairwise'], rubric: R, pairwise: P }));
}

module.exports.addTask = addTask;
module.exports.writeJudgments = writeJudgments;
