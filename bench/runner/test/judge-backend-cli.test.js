// SPDX-License-Identifier: Apache-2.0
'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { systemPromptSha256 } = require('../../judge/backends.js');
const { LEDGER_FILE } = require('../lib/credit-ledger.js');
const { sandbox, readJ, FAKE_JUDGE } = require('./judge-backend-sandbox.js');

test('judge --judge-backend opencode runs end to end through the fake binary and records everything', () => {
  const s = sandbox();
  try {
    const run = s.mkRun('r');
    const r = s.oc(run, '--mode', 'rubric,pairwise,graded');
    assert.equal(r.status, 0, r.stderr);
    assert.match(r.stdout, /live spend \$0\.\d+ USD \(all invocations: \$0\.\d+\), 0 credits/);
    assert.match(r.stdout, /usd: this command \$0\.\d+/);
    const j = readJ(run);
    assert.equal(j.backend, 'opencode');
    assert.deepEqual(j.judges, ['deepseek-3.2', 'glm-5', 'gpt-5.6-luna']);
    assert.equal(j.backendInfo.opencodeVersion, '1.19.5');
    assert.equal(j.backendInfo.region, 'us-east-1');
    assert.equal(j.backendInfo.systemPromptSha256, systemPromptSha256());
    assert.equal(j.backendInfo.models['gpt-5.6-luna'].bedrockModelId, 'global.openai.gpt-5.6-luna');
    assert.equal(j.backendInfo.models['gpt-5.6-luna'].temperatureApplied, false);
    assert.equal(j.backendInfo.models['deepseek-3.2'].temperatureApplied, true);
    assert.equal(j.spentCredits, 0);
    assert.ok(j.spentUsd > 0);
    assert.equal(j.rubric.length, 6);
    assert.ok(j.pairwise.every((p) => p.orderings.every(Boolean)) && j.graded.every((g) => g.orderings.every(Boolean)));
    assert.equal(s.calls().length, 3 * (2 + 2 + 2));
    const ledger = fs.readFileSync(path.join(run, LEDGER_FILE), 'utf8').trim().split('\n').map((l) => JSON.parse(l));
    assert.equal(ledger.length, 18);
    assert.ok(ledger.every((l) => l.unit === 'usd' && l.credits === 0 && l.usd > 0));
    assert.deepEqual(fs.readdirSync(s.tmpdir), [], 'no scratch left in TMPDIR');
    assert.ok(fs.existsSync(path.join(run, 'judge', 'cache')));
  } finally { s.cleanup(); }
});

test('a rerun of the same backend is served from the cache: no new opencode call, no new USD', () => {
  const s = sandbox();
  try {
    const run = s.mkRun('r');
    assert.equal(s.oc(run, '--mode', 'rubric').status, 0);
    const n = s.calls().length;
    const again = s.oc(run, '--mode', 'rubric');
    assert.equal(again.status, 0, again.stderr);
    assert.equal(s.calls().length, n);
    const j = readJ(run);
    assert.equal(j.invocations.length, 2);
    assert.equal(j.invocations[1].spentUsd, 0);
    assert.equal(j.invocations[1].cachedCalls, n);
  } finally { s.cleanup(); }
});

test('kiro stays the default: --judge-cmd records the kiro label, credits and no USD fields', () => {
  const s = sandbox();
  try {
    const run = s.mkRun('r');
    const r = s.cli(['judge', '--run', run, '--bench-dir', s.bench, '--judges', 'gpt-test', '--allow-small-panel', '--judge-cmd', FAKE_JUDGE]);
    assert.equal(r.status, 0, r.stderr);
    const j = readJ(run);
    assert.equal(j.backend, 'kiro');
    assert.equal(j.spentUsd, undefined);
    assert.equal(j.backendInfo, undefined);
  } finally { s.cleanup(); }
});

test('refusals: unknown backend, judge-cmd with opencode, budget-credits with opencode, budget-usd with kiro, missing credentials flag', () => {
  const s = sandbox();
  try {
    const run = s.mkRun('r');
    const base = ['judge', '--run', run, '--bench-dir', s.bench];
    const bad = s.cli([...base, '--judge-backend', 'bedrock', '--judge-cmd', FAKE_JUDGE, '--judges', 'gpt-test', '--allow-small-panel']);
    assert.equal(bad.status, 1);
    assert.match(bad.stderr, /--judge-backend takes kiro or opencode/);
    assert.match(s.oc(run, '--judge-cmd', FAKE_JUDGE).stderr, /--judge-cmd and --judge-backend opencode cannot be used together/);
    assert.match(s.oc(run, '--budget-credits', '5').stderr, /--budget-credits does not apply to the opencode backend; use --budget-usd/);
    assert.match(s.cli([...base, '--judges', 'gpt-test', '--allow-small-panel', '--judge-cmd', FAKE_JUDGE, '--budget-usd', '1']).stderr, /--budget-usd applies to the opencode backend only/);
    const noCreds = s.cli([...base, '--judge-backend', 'opencode', '--opencode-bin', s.fake.file]);
    assert.match(noCreds.stderr, /--aws-creds-file is required/);
    const badProfile = s.cli([...base, '--judge-backend', 'opencode', '--opencode-bin', s.fake.file, '--aws-creds-file', s.creds, '--aws-profile', 'nope']);
    assert.match(badProfile.stderr, /profile "nope" not found/);
    assert.equal(fs.existsSync(path.join(run, 'judgments.json')), false);
    assert.equal(s.calls().length, 0);
  } finally { s.cleanup(); }
});

test('with the opencode backend a judge needs a Bedrock mapping: a raw Bedrock id or an unknown id is refused before any call', () => {
  const s = sandbox();
  try {
    const run = s.mkRun('r');
    const a = s.oc(run, '--judges', 'gpt-5.6-luna,deepseek.v3.2,glm-5');
    assert.equal(a.status, 1);
    assert.match(a.stderr, /deepseek\.v3\.2.*use the panel id "deepseek-3\.2"/s);
    const b = s.oc(run, '--judges', 'gpt-test', '--allow-small-panel');
    assert.match(b.stderr, /no Bedrock mapping for judge "gpt-test"/);
    assert.equal(s.calls().length, 0);
  } finally { s.cleanup(); }
});

test('GPT subject: luna is dropped, qwen3-coder-next joins, and the three judges map to their Bedrock ids', () => {
  const s = sandbox({ model: 'gpt-5.6-sol' });
  try {
    const run = s.mkRun('r');
    const r = s.oc(run, '--mode', 'rubric');
    assert.equal(r.status, 0, r.stderr);
    assert.match(r.stdout, /dropped gpt-5\.6-luna, added qwen3-coder-next/);
    const j = readJ(run);
    assert.deepEqual(j.judges, ['deepseek-3.2', 'glm-5', 'qwen3-coder-next']);
    assert.deepEqual(Object.values(j.backendInfo.models).map((m) => m.bedrockModelId).sort(), ['deepseek.v3.2', 'qwen.qwen3-coder-next', 'zai.glm-5']);
    const models = new Set(s.calls().map((c) => c.args[c.args.indexOf('-m') + 1]));
    assert.deepEqual([...models].sort(), ['amazon-bedrock/deepseek.v3.2', 'amazon-bedrock/qwen.qwen3-coder-next', 'amazon-bedrock/zai.glm-5']);
  } finally { s.cleanup(); }
});

test('mixing backends in one directory is refused both ways and leaves judgments.json alone', () => {
  const s = sandbox();
  try {
    const a = s.mkRun('a');
    assert.equal(s.cli(['judge', '--run', a, '--bench-dir', s.bench, '--judges', 'gpt-test', '--allow-small-panel', '--judge-cmd', FAKE_JUDGE]).status, 0);
    const before = fs.readFileSync(path.join(a, 'judgments.json'), 'utf8');
    const r = s.oc(a, '--judges', 'glm-5', '--allow-small-panel');
    assert.equal(r.status, 1);
    assert.match(r.stderr, /already judged on the kiro backend/);
    assert.equal(fs.readFileSync(path.join(a, 'judgments.json'), 'utf8'), before);
    assert.equal(s.calls().length, 0);

    const b = s.mkRun('b');
    assert.equal(s.oc(b, '--mode', 'rubric').status, 0);
    const back = s.cli(['judge', '--run', b, '--bench-dir', s.bench, '--judges', 'gpt-test', '--allow-small-panel', '--judge-cmd', FAKE_JUDGE]);
    assert.equal(back.status, 1);
    assert.match(back.stderr, /already judged on the opencode backend/);
  } finally { s.cleanup(); }
});

test('--budget-usd stops new calls at 90% of the cap and the command exits 3 on a hard stop', () => {
  const s = sandbox();
  try {
    s.fake.setConfig({ cost: 0.01 });
    const run = s.mkRun('r');
    const r = s.oc(run, '--mode', 'rubric', '--judges', 'deepseek-3.2,glm-5,gpt-5.6-luna', '--budget-usd', '0.02', '--concurrency', '1');
    assert.equal(r.status, 3, r.stderr);
    assert.match(r.stderr, /usd guard: HARD STOP/);
    assert.equal(s.calls().length, 2);
    const j = readJ(run);
    assert.equal(j.rubric.length, 6);
    assert.equal(j.rubric.filter((x) => /^budget reached/.test(x.judgeError || '')).length, 4);
  } finally { s.cleanup(); }
});
