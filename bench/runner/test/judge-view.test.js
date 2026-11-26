// SPDX-License-Identifier: Apache-2.0
'use strict';

// Judge views (bench/judge/view): how the judge sees a run. The choice order (the --judge-view flag, then the task's
// judgeView, then bundle), the refusals (unknown id, reserved id, a view the backend does not offer), and the view id in
// judgments.json. Stub callers only; no model call.

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { tmp, makeBench, makeRun } = require('./helpers.js');
const { runJudging, planJudging } = require('../../judge/run.js');
const { loadTasks } = require('../lib/tasks.js');
const { viewOf, chooseViewId, checkViewBackend, VIEW_IDS, RESERVED_VIEW_IDS } = require('../../judge/view/index.js');
const { backendRegistry } = require('../../judge/backends.js');
const { compileRedactions, DEFAULT_REDACTIONS } = require('../../judge/redact.js');

function reply(prompt) {
  const ids = [...prompt.matchAll(/^- id: (\S+)/gm)].map((m) => m[1]);
  return JSON.stringify({ criteria: ids.map((id) => ({ id, verdict: 'pass', evidence: 'a.txt' })) });
}

function stub() {
  const calls = [];
  const fn = async ({ model, prompt }) => { calls.push({ model, prompt }); return { text: reply(prompt), credits: 0.1, latencyMs: 1 }; };
  fn.calls = calls;
  return fn;
}

function fixture(taskExtra = {}) {
  const root = tmp();
  const bench = makeBench(path.join(root, 'bench'));
  const tf = path.join(bench, 'tasks', 't1.json');
  fs.writeFileSync(tf, JSON.stringify({ ...JSON.parse(fs.readFileSync(tf, 'utf8')), ...taskExtra }));
  const runDir = makeRun(path.join(root, 'run'), bench, [{ arm: 'vanilla', files: { 'a.txt': 'fixed\n' } }]);
  const common = {
    runDir, benchDir: bench, judges: ['gpt-test'], modes: ['rubric'], baseline: 'vanilla', concurrency: 1, budgetCredits: null,
    limits: { maxFileChars: 6000, maxBundleChars: 24000 }, redactions: compileRedactions(DEFAULT_REDACTIONS), log: () => {},
  };
  return { root, bench, tf, runDir, common, cleanup: () => fs.rmSync(root, { recursive: true, force: true }) };
}

test('the view ids: bundle and read are built; full, conversation and notes are reserved and refused as not built yet', () => {
  assert.deepEqual(VIEW_IDS, ['bundle', 'read']);
  assert.deepEqual(RESERVED_VIEW_IDS, ['full', 'conversation', 'notes']);
  assert.equal(viewOf('bundle').id, 'bundle');
  assert.equal(viewOf('read').id, 'read');
  for (const id of RESERVED_VIEW_IDS) assert.throws(() => viewOf(id), new RegExp(`judge view "${id}" is not built yet`));
  assert.throws(() => viewOf('pasted'), /unknown judge view "pasted": the judge views are bundle, read/);
});

test('choice order: the --judge-view flag wins, then the task\'s judgeView, then bundle', () => {
  assert.equal(chooseViewId({ flag: null, task: {} }), 'bundle');
  assert.equal(chooseViewId({ flag: null, task: { judgeView: 'read' } }), 'read');
  assert.equal(chooseViewId({ flag: 'bundle', task: { judgeView: 'read' } }), 'bundle');
  assert.equal(chooseViewId({ flag: 'read', task: {} }), 'read');
  assert.throws(() => chooseViewId({ flag: 'notes', task: {} }), /not built yet/);
});

test('the task schema takes judgeView bundle or read; a reserved id is refused as not built yet, an unknown one by the schema', () => {
  const f = fixture();
  try {
    const task = JSON.parse(fs.readFileSync(f.tf, 'utf8'));
    for (const id of VIEW_IDS) {
      fs.writeFileSync(f.tf, JSON.stringify({ ...task, judgeView: id }));
      assert.equal(loadTasks(f.bench).get('t1').judgeView, id);
    }
    fs.writeFileSync(f.tf, JSON.stringify({ ...task, judgeView: 'full' }));
    assert.throws(() => loadTasks(f.bench), /judgeView: judge view "full" is not built yet/);
    fs.writeFileSync(f.tf, JSON.stringify({ ...task, judgeView: 'pasted' }));
    assert.throws(() => loadTasks(f.bench), /judgeView/);
  } finally { f.cleanup(); }
});

test('a view needs what the backend descriptor offers: opencode offers readTools, kiro offers nothing', () => {
  const reg = backendRegistry();
  assert.deepEqual(reg.part('opencode').meta.offers, ['readTools']);
  assert.equal(reg.part('kiro').meta.offers, undefined);
  assert.doesNotThrow(() => checkViewBackend(viewOf('read'), reg.part('opencode')));
  assert.doesNotThrow(() => checkViewBackend(viewOf('bundle'), reg.part('kiro')));
  assert.throws(() => checkViewBackend(viewOf('read'), reg.part('kiro')), /judge view "read" needs readTools, which the kiro judge backend does not offer \(it offers: nothing\)/);
});

test('read on the kiro backend is refused before any call, from the task and from the flag', async () => {
  for (const [taskExtra, flag] of [[{ judgeView: 'read' }, undefined], [{}, 'read']]) {
    const f = fixture(taskExtra);
    try {
      const caller = stub();
      await assert.rejects(runJudging({ ...f.common, caller, judgeView: flag }), /judge view "read" needs readTools, which the kiro judge backend does not offer/);
      assert.equal(caller.calls.length, 0);
      assert.throws(() => planJudging({ ...f.common, judgeView: flag }), /needs readTools/);
      assert.equal(fs.existsSync(path.join(f.runDir, 'judgments.json')), false);
    } finally { f.cleanup(); }
  }
});

test('the flag overrides the task: --judge-view bundle judges a read task with today\'s view, and the record says bundle', async () => {
  const f = fixture({ judgeView: 'read' });
  try {
    const caller = stub();
    const j = await runJudging({ ...f.common, caller, judgeView: 'bundle' });
    assert.equal(caller.calls.length, 1);
    assert.equal(j.rubric[0].judgeView, 'bundle');
    assert.equal(j.rubric[0].judgeError, null);
  } finally { f.cleanup(); }
});

test('the view id is recorded on every record and per invocation in judgments.json', async () => {
  const f = fixture();
  try {
    await runJudging({ ...f.common, caller: stub() });
    const j = JSON.parse(fs.readFileSync(path.join(f.runDir, 'judgments.json'), 'utf8'));
    assert.equal(j.rubric[0].judgeView, 'bundle');
    assert.deepEqual(j.invocations[0].judgeViews, { t1: 'bundle' });
  } finally { f.cleanup(); }
});

test('an unknown or reserved --judge-view is refused before any call', async () => {
  for (const [flag, re] of [['pasted', /unknown judge view "pasted"/], ['conversation', /not built yet/]]) {
    const f = fixture();
    try {
      const caller = stub();
      await assert.rejects(runJudging({ ...f.common, caller, judgeView: flag }), re);
      assert.equal(caller.calls.length, 0);
    } finally { f.cleanup(); }
  }
});

test('judge CLI: --judge-view read on the kiro backend and a reserved --judge-view are refused before any call', () => {
  const { sandbox, FAKE_JUDGE } = require('./judge-backend-sandbox.js');
  const s = sandbox();
  try {
    const run = s.mkRun('run', ['vanilla']);
    const base = ['judge', '--run', run, '--bench-dir', s.bench, '--judges', 'gpt-test', '--allow-small-panel', '--judge-cmd', FAKE_JUDGE, '--mode', 'rubric'];
    const read = s.cli([...base, '--judge-view', 'read']);
    assert.equal(read.status, 1);
    assert.match(read.stderr, /judge view "read" needs readTools, which the kiro judge backend does not offer/);
    const notes = s.cli([...base, '--judge-view', 'notes']);
    assert.equal(notes.status, 1);
    assert.match(notes.stderr, /judge view "notes" is not built yet/);
    assert.equal(fs.existsSync(path.join(run, 'judgments.json')), false);
    const ok = s.cli([...base, '--judge-view', 'bundle']);
    assert.equal(ok.status, 0, ok.stderr);
  } finally { s.cleanup(); }
});
