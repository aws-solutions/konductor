// SPDX-License-Identifier: Apache-2.0
'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { tmp, makeBench, makeRun } = require('./helpers.js');
const { runJudging } = require('../../judge/run.js');
const { makeCmdCaller, withCache } = require('../../judge/model.js');
const { checkJudgeModel, checkPanel } = require('../../judge/config.js');
const { compileRedactions, DEFAULT_REDACTIONS } = require('../../judge/redact.js');

const FAKE = `node ${path.join(__dirname, 'fake-judge.js')}`;

function reply(prompt, { verdict = 'pass', winner = 'A' } = {}) {
  const ids = [...prompt.matchAll(/^- id: (\S+)/gm)].map((m) => m[1]);
  return !prompt.includes('=== RESPONSE A ===')
    ? JSON.stringify({ criteria: ids.map((id) => ({ id, verdict, evidence: 'a.txt' })) })
    : JSON.stringify({ winner, reason: 'r' });
}

// handler(call) returns text or {error}; every call is recorded.
function stub(handler = (c) => reply(c.prompt)) {
  const calls = [];
  let active = 0;
  let peak = 0;
  const fn = async ({ model, prompt }) => {
    const c = { model, prompt, n: calls.length };
    calls.push(c);
    active++; peak = Math.max(peak, active);
    await new Promise((r) => setTimeout(r, 5));
    active--;
    const out = handler(c);
    return typeof out === 'string' ? { text: out, credits: 0.1, latencyMs: 10 } : { text: '', credits: 0, latencyMs: 10, ...out };
  };
  fn.calls = calls;
  fn.peak = () => peak;
  return fn;
}

function fixture(arms = ['vanilla', 'v1.2.0'], extra = {}) {
  const root = tmp();
  const bench = makeBench(path.join(root, 'bench'));
  const runDir = makeRun(path.join(root, 'run'), bench, arms.map((arm) => ({
    arm, finalText: `${arm} says: the k-developer agent fixed it`, files: { 'a.txt': `fixed by ${arm}\n` }, ...extra,
  })));
  const common = {
    runDir, benchDir: bench, judges: ['gpt-test'], modes: ['rubric', 'pairwise'], baseline: 'vanilla',
    concurrency: 2, budgetCredits: null, limits: { maxFileChars: 6000, maxBundleChars: 24000 },
    redactions: compileRedactions(DEFAULT_REDACTIONS), log: () => {},
  };
  return { root, runDir, common };
}
const cleanup = (root) => fs.rmSync(root, { recursive: true, force: true });

test('rubric scoring: one record per run with weighted score and criteria', async () => {
  const { root, common } = fixture();
  try {
    const j = await runJudging({ ...common, modes: ['rubric'], caller: stub((c) => reply(c.prompt, { verdict: 'partial' })) });
    assert.equal(j.rubric.length, 2);
    assert.ok(j.rubric.every((r) => r.score === 0.5 && r.judgeError === null && r.criteria.length === 2));
    assert.equal(j.pairwise.length, 0);
  } finally { cleanup(root); }
});

test('judge sees task, rubric, answer key and redacted bundle but no arm labels or transcript', async () => {
  const { root, common } = fixture();
  try {
    const caller = stub();
    await runJudging({ ...common, caller });
    assert.ok(caller.calls.length > 0);
    for (const { prompt } of caller.calls) {
      assert.match(prompt, /Fix the thing\./);
      assert.match(prompt, /Does the second thing\./);
      assert.match(prompt, /KEY: the seeded defect/);
      assert.doesNotMatch(prompt, /k-developer|konductor|v1\.2\.0|subagent|toolName|tool_call/i);
    }
  } finally { cleanup(root); }
});

test('invalid JSON is retried once; a good second reply is used and the failure is recorded', async () => {
  const { root, common } = fixture(['vanilla']);
  try {
    const caller = stub((c) => (c.n === 0 ? 'Sure, here you go' : reply(c.prompt)));
    const j = await runJudging({ ...common, modes: ['rubric'], caller });
    assert.equal(caller.calls.length, 2);
    assert.match(caller.calls[1].prompt, /could not be used/);
    assert.equal(j.rubric[0].parseFailures, 1);
    assert.equal(j.rubric[0].judgeError, null);
    assert.equal(j.rubric[0].score, 1);
  } finally { cleanup(root); }
});

test('two bad replies record judgeError and keep the run in the output', async () => {
  const { root, common } = fixture(['vanilla']);
  try {
    const j = await runJudging({ ...common, modes: ['rubric'], caller: stub(() => '{"criteria": []}') });
    assert.equal(j.rubric.length, 1);
    assert.equal(j.rubric[0].score, null);
    assert.equal(j.rubric[0].parseFailures, 2);
    assert.match(j.rubric[0].judgeError, /unusable after retry/);
  } finally { cleanup(root); }
});

test('a transport error is recorded without a retry', async () => {
  const { root, common } = fixture(['vanilla']);
  try {
    const caller = stub(() => ({ error: 'timed out' }));
    const j = await runJudging({ ...common, modes: ['rubric'], caller });
    assert.equal(caller.calls.length, 1);
    assert.equal(j.rubric[0].judgeError, 'timed out');
  } finally { cleanup(root); }
});

test('pairwise runs both orderings with positions swapped and blinds the labels', async () => {
  const { root, common } = fixture();
  try {
    const caller = stub((c) => reply(c.prompt, { winner: 'A' }));
    const j = await runJudging({ ...common, modes: ['pairwise'], caller });
    assert.equal(caller.calls.length, 2);
    const posOf = (prompt, arm) => (prompt.indexOf(`${arm} says`) < prompt.indexOf('RESPONSE B') ? 'A' : 'B');
    const [first, second] = caller.calls.map((c) => c.prompt).sort((a, b) => posOf(a, 'vanilla').localeCompare(posOf(b, 'vanilla')));
    assert.equal(posOf(first, 'vanilla'), 'A');
    assert.equal(posOf(second, 'vanilla'), 'B');
    assert.equal(j.pairwise.length, 1);
    const p = j.pairwise[0];
    assert.equal(p.armId, 'v1.2.0');
    assert.equal(p.baselineId, 'vanilla');
    assert.equal(p.verdict, 'tie');
    assert.equal(p.positionInconsistent, true);
  } finally { cleanup(root); }
});

test('pairwise agrees across orderings into a win when the arm wins in both', async () => {
  const { root, common } = fixture();
  try {
    const caller = stub((c) => {
      const sectionA = c.prompt.slice(c.prompt.indexOf('RESPONSE A'), c.prompt.indexOf('RESPONSE B'));
      const baselineIsA = /vanilla says/.test(sectionA);
      return reply(c.prompt, { winner: baselineIsA ? 'B' : 'A' });
    });
    const j = await runJudging({ ...common, modes: ['pairwise'], caller });
    assert.equal(j.pairwise[0].verdict, 'win');
    assert.equal(j.pairwise[0].positionInconsistent, false);
  } finally { cleanup(root); }
});

test('cache makes a rerun free and identical', async () => {
  const { root, common } = fixture();
  try {
    const first = stub();
    const a = await runJudging({ ...common, caller: first });
    const second = stub();
    const b = await runJudging({ ...common, caller: second });
    assert.ok(first.calls.length > 0);
    assert.equal(second.calls.length, 0);
    assert.equal(b.invocations[1].spentCredits, 0);
    assert.equal(b.spentCredits, a.spentCredits, 'earlier spend is kept');
    assert.deepEqual(b.rubric.map((r) => r.score), a.rubric.map((r) => r.score));
    assert.ok([...b.rubric, ...b.pairwise].flatMap((r) => r.calls).every((c) => c.cached));
  } finally { cleanup(root); }
});

test('concurrency is capped', async () => {
  const { root, common } = fixture(['vanilla', 'v1.2.0', 'v1.1.0', 'main']);
  try {
    const caller = stub();
    await runJudging({ ...common, concurrency: 2, caller });
    assert.ok(caller.peak() <= 2);
    assert.ok(caller.peak() >= 1);
  } finally { cleanup(root); }
});

test('budget guard stops new judge calls and records the skipped units', async () => {
  const { root, common } = fixture(['vanilla', 'v1.2.0', 'v1.1.0', 'main']);
  try {
    const caller = stub();
    const j = await runJudging({ ...common, modes: ['rubric'], concurrency: 1, budgetCredits: 0.15, caller });
    assert.equal(j.rubric.length, 4);
    const skipped = j.rubric.filter((r) => /budget/.test(r.judgeError || ''));
    assert.ok(skipped.length >= 1 && skipped.length < 4);
    assert.ok(caller.calls.length < 4);
  } finally { cleanup(root); }
});

test('missing baseline run is recorded, not dropped', async () => {
  const { root, common } = fixture(['v1.2.0']);
  try {
    const j = await runJudging({ ...common, modes: ['pairwise'], caller: stub() });
    assert.equal(j.pairwise.length, 1);
    assert.match(j.pairwise[0].judgeError, /no baseline run/);
  } finally { cleanup(root); }
});

test('an empty evidence string is not counted as a found quote', async () => {
  const { root, common } = fixture(['vanilla']);
  try {
    const empty = (c) => JSON.stringify({ criteria: [...c.prompt.matchAll(/^- id: (\S+)/gm)].map((m) => ({ id: m[1], verdict: 'pass', evidence: '' })) });
    const j = await runJudging({ ...common, modes: ['rubric'], caller: stub(empty) });
    assert.ok(j.rubric[0].criteria.every((c) => c.evidenceFound === false));
  } finally { cleanup(root); }
});

test('records which redactions fired for each judged run', async () => {
  const { root, common } = fixture(['v1.2.0']);
  try {
    const j = await runJudging({ ...common, modes: ['rubric'], caller: stub() });
    assert.ok(j.rubric[0].redactionsFired['agent-name'] >= 1);
  } finally { cleanup(root); }
});

test('judge model family check refuses Claude and the subject family', () => {
  assert.throws(() => checkJudgeModel('claude-sonnet-4.6', 'claude-sonnet-5.5'), /Claude/);
  assert.throws(() => checkJudgeModel('gpt-5.6-luna', 'gpt-5.5'), /same family/);
  assert.doesNotThrow(() => checkJudgeModel('gpt-5.6-luna', 'claude-sonnet-5.5'));
  assert.doesNotThrow(() => checkJudgeModel('deepseek-3.2', 'claude-sonnet-5.5'));
});

test('cmd caller runs an external judge with the prompt on stdin', async () => {
  const caller = makeCmdCaller(FAKE, { timeoutMs: 20000 });
  const ok = await caller({ model: 'm', prompt: '- id: c1\n- id: c2\n' });
  assert.deepEqual(JSON.parse(ok.text).criteria.map((c) => c.id), ['c1', 'c2']);
  process.env.FAKE_JUDGE_MODE = 'crash';
  try {
    const bad = await caller({ model: 'm', prompt: 'x' });
    assert.match(bad.error, /exit 3/);
  } finally { delete process.env.FAKE_JUDGE_MODE; }
});

test('withCache keys on model and prompt and skips failed calls', async () => {
  const dir = tmp();
  try {
    let n = 0;
    const inner = async ({ model }) => (n++ === 0 ? { error: 'x' } : { text: `r-${model}`, credits: 0.2, latencyMs: 5 });
    const cached = withCache(inner, dir);
    assert.ok((await cached({ model: 'm', prompt: 'p' })).error);
    assert.equal((await cached({ model: 'm', prompt: 'p' })).cached, undefined);
    const hit = await cached({ model: 'm', prompt: 'p' });
    assert.equal(hit.cached, true);
    assert.equal(hit.credits, 0);
    assert.equal(hit.originalCredits, 0.2);
    assert.equal(hit.latencyMs, 5);
    assert.equal((await cached({ model: 'other', prompt: 'p' })).text, 'r-other');
    assert.equal(n, 3);
  } finally { cleanup(dir); }
});

test('a judge panel needs one judge per model family', () => {
  assert.doesNotThrow(() => checkPanel(['gpt-5.6-luna', 'deepseek-3.2', 'glm-5', 'qwen3-coder-next']));
  assert.throws(() => checkPanel(['gpt-5.6-luna', 'gpt-5.6-sol']), /one judge per family/);
});
