// SPDX-License-Identifier: Apache-2.0
'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const { tmp, makeBench, makeRun } = require('./helpers.js');
const { runJudging, judgeOnce } = require('../../judge/run.js');
const { withCache } = require('../../judge/model.js');
const { compileRedactions, DEFAULT_REDACTIONS } = require('../../judge/redact.js');
const { LEDGER_FILE } = require('../lib/credit-ledger.js');
const { resolveJudges } = require('../eval-commands.js');
const { checkOpencodeJudges, opencodeModel } = require('../../judge/backends.js');

const info = (...judges) => ({ backend: 'opencode', opencodeVersion: '1.19.5', region: 'us-east-1', systemPromptSha256: 'a'.repeat(64), models: Object.fromEntries(judges.map((j) => [j, { bedrockModelId: opencodeModel(j).bedrockId }])) });

function reply(prompt) {
  const ids = [...prompt.matchAll(/^- id: (\S+)/gm)].map((m) => m[1]);
  if (prompt.includes('"gradeA"')) return JSON.stringify({ gradeA: 4, gradeB: 3, reason: 'r' });
  return !prompt.includes('=== RESPONSE A ===') ? JSON.stringify({ criteria: ids.map((id) => ({ id, verdict: 'pass', evidence: 'a.txt' })) }) : JSON.stringify({ winner: 'A', reason: 'r' });
}

// A caller that behaves like the opencode one: no credits, USD and tokens per call.
function usdStub({ usd = 0.01 } = {}) {
  const calls = [];
  const fn = async ({ model, prompt }) => {
    calls.push({ model, prompt });
    return { text: reply(prompt), credits: 0, usd, tokens: { input: 100, output: 10, reasoning: 0, cacheRead: 0, cacheWrite: 0 }, latencyMs: 5 };
  };
  fn.calls = calls;
  return fn;
}

function fixture(arms = ['vanilla', 'v1.2.0']) {
  const root = tmp();
  const bench = makeBench(path.join(root, 'bench'));
  const runDir = makeRun(path.join(root, 'run'), bench, arms.map((arm) => ({ arm, finalText: `${arm} done`, files: { 'a.txt': `fixed by ${arm}\n` } })));
  const common = {
    runDir, benchDir: bench, judges: ['deepseek-3.2'], modes: ['rubric', 'pairwise'], baseline: 'vanilla', concurrency: 1, budgetCredits: null,
    limits: { maxFileChars: 6000, maxBundleChars: 24000 }, redactions: compileRedactions(DEFAULT_REDACTIONS), log: () => {},
  };
  return { root, runDir, common, cleanup: () => fs.rmSync(root, { recursive: true, force: true }) };
}

test('the cache key of the default (kiro) path is unchanged, so earlier cached answers still hit', async () => {
  const dir = tmp();
  try {
    const sha = crypto.createHash('sha256').update('glm-5\nPROMPT').digest('hex');
    fs.writeFileSync(path.join(dir, `${sha}.json`), JSON.stringify({ model: 'glm-5', response: 'cached', credits: 0.3, latencyMs: 9 }));
    let live = 0;
    const c = withCache(async () => { live++; return { text: 'live', credits: 0 }; }, dir);
    const r = await c({ model: 'glm-5', prompt: 'PROMPT' });
    assert.deepEqual([r.text, r.cached, live], ['cached', true, 0]);
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test('kiro and opencode answers never serve each other: the backend and system prompt are part of the key', async () => {
  const dir = tmp();
  try {
    const kiro = withCache(async () => ({ text: 'from kiro', credits: 0.2, latencyMs: 1 }), dir);
    const oc = withCache(async () => ({ text: 'from opencode', credits: 0, usd: 0.004, latencyMs: 2, bedrockModelId: 'zai.glm-5' }), dir, { salt: () => 'opencode\nsys1\nzai.glm-5\nt0' });
    const oc2 = withCache(async () => ({ text: 'from opencode, other prompt', credits: 0, usd: 0.004, latencyMs: 2 }), dir, { salt: () => 'opencode\nsys2\nzai.glm-5\nt0' });
    assert.equal((await kiro({ model: 'glm-5', prompt: 'P' })).text, 'from kiro');
    const first = await oc({ model: 'glm-5', prompt: 'P' });
    assert.equal(first.text, 'from opencode');
    assert.equal(first.cached, undefined);
    const again = await oc({ model: 'glm-5', prompt: 'P' });
    assert.deepEqual([again.text, again.cached, again.usd, again.originalUsd], ['from opencode', true, 0, 0.004]);
    assert.equal((await oc2({ model: 'glm-5', prompt: 'P' })).text, 'from opencode, other prompt', 'another system prompt hash is a miss');
    assert.equal((await kiro({ model: 'glm-5', prompt: 'P' })).text, 'from kiro');
    assert.equal(fs.readdirSync(dir).length, 3);
    const entry = JSON.parse(fs.readFileSync(path.join(dir, fs.readdirSync(dir).find((f) => JSON.parse(fs.readFileSync(path.join(dir, f), 'utf8')).response === 'from opencode')), 'utf8'));
    assert.equal(entry.backend, 'opencode');
    assert.equal(entry.bedrockModelId, 'zai.glm-5');
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test('judgments.json records the backend, the opencode version, region, prompt hash, model ids and USD; credits stay 0', async () => {
  const f = fixture();
  try {
    const j = await runJudging({ ...f.common, caller: usdStub(), backend: 'opencode', backendInfo: info('deepseek-3.2') });
    assert.equal(j.backend, 'opencode');
    assert.equal(j.backendInfo.opencodeVersion, '1.19.5');
    assert.equal(j.backendInfo.region, 'us-east-1');
    assert.equal(j.backendInfo.systemPromptSha256, 'a'.repeat(64));
    assert.deepEqual(j.backendInfo.models, { 'deepseek-3.2': { bedrockModelId: 'deepseek.v3.2' } });
    assert.equal(j.spentCredits, 0);
    assert.ok(Math.abs(j.spentUsd - 0.04) < 1e-9, `spentUsd ${j.spentUsd}`);
    assert.ok(Math.abs(j.spentUsdByJudge['deepseek-3.2'] - 0.04) < 1e-9);
    const onDisk = JSON.parse(fs.readFileSync(path.join(f.runDir, 'judgments.json'), 'utf8'));
    assert.equal(onDisk.backend, 'opencode');
    assert.ok(onDisk.rubric[0].calls[0].usd === 0.01 && onDisk.rubric[0].calls[0].tokens.input === 100);
    const lines = fs.readFileSync(path.join(f.runDir, LEDGER_FILE), 'utf8').trim().split('\n').map((x) => JSON.parse(x));
    assert.equal(lines.length, 4);
    assert.ok(lines.every((x) => x.kind === 'judge' && x.unit === 'usd' && x.usd === 0.01 && x.credits === 0 && x.ok));
  } finally { f.cleanup(); }
});

test('the default backend writes the kiro label and none of the USD fields', async () => {
  const f = fixture();
  try {
    const j = await runJudging({ ...f.common, judges: ['gpt-test'], caller: async ({ prompt }) => ({ text: reply(prompt), credits: 0.1, latencyMs: 1 }) });
    assert.equal(j.backend, 'kiro');
    assert.equal(j.backendInfo, undefined);
    assert.equal(j.spentUsd, undefined);
    const lines = fs.readFileSync(path.join(f.runDir, LEDGER_FILE), 'utf8').trim().split('\n').map((x) => JSON.parse(x));
    assert.ok(lines.every((x) => x.unit === 'credits' && x.usd === undefined));
  } finally { f.cleanup(); }
});

test('both pairwise orders and both graded orders still run on the opencode backend', async () => {
  const f = fixture();
  try {
    const caller = usdStub();
    const j = await runJudging({ ...f.common, caller, modes: ['rubric', 'pairwise', 'graded'], backend: 'opencode', backendInfo: info('deepseek-3.2') });
    assert.equal(caller.calls.length, 2 + 2 + 2);
    assert.ok(j.pairwise.every((r) => r.orderings.every(Boolean)));
    assert.ok(j.graded.every((r) => r.orderings.every(Boolean)));
  } finally { f.cleanup(); }
});

test('USD budget: new calls stop at 90% of --budget-usd and the rest are recorded as budget-skipped', async () => {
  const f = fixture();
  try {
    const caller = usdStub({ usd: 0.01 });
    const j = await runJudging({ ...f.common, caller, backend: 'opencode', backendInfo: info('deepseek-3.2'), budgetUsd: 0.02 });
    assert.equal(caller.calls.length, 2);
    assert.match(j.rubric.concat(j.pairwise).map((r) => r.judgeError).filter(Boolean)[0], /^budget reached \(usd guard/);
    assert.equal(j.guardState, 'hard');
  } finally { f.cleanup(); }
});

test('credits and USD budgets cannot be mixed: the wrong one is refused', async () => {
  const f = fixture();
  try {
    await assert.rejects(runJudging({ ...f.common, caller: usdStub(), backend: 'opencode', backendInfo: info('deepseek-3.2'), budgetCredits: 5 }), /--budget-credits does not apply to the opencode backend; use --budget-usd/);
    await assert.rejects(runJudging({ ...f.common, caller: usdStub(), backend: 'kiro', budgetUsd: 1 }), /--budget-usd applies to the opencode backend only/);
  } finally { f.cleanup(); }
});

test('one backend per results directory: kiro then opencode, opencode then kiro and unrecorded then opencode are all refused', async () => {
  const f = fixture();
  try {
    await runJudging({ ...f.common, judges: ['gpt-test'], caller: async ({ prompt }) => ({ text: reply(prompt), credits: 0.1 }) });
    const before = fs.readFileSync(path.join(f.runDir, 'judgments.json'), 'utf8');
    await assert.rejects(runJudging({ ...f.common, caller: usdStub(), backend: 'opencode', backendInfo: info('deepseek-3.2') }), /already judged on the kiro backend.*cannot add opencode judgments/s);
    assert.equal(fs.readFileSync(path.join(f.runDir, 'judgments.json'), 'utf8'), before);

    const legacy = JSON.parse(before);
    delete legacy.backend;
    fs.writeFileSync(path.join(f.runDir, 'judgments.json'), JSON.stringify(legacy));
    await assert.rejects(runJudging({ ...f.common, caller: usdStub(), backend: 'opencode', backendInfo: info('deepseek-3.2') }), /already judged on the kiro backend/);

    fs.rmSync(path.join(f.runDir, 'judgments.json'));
    await runJudging({ ...f.common, caller: usdStub(), backend: 'opencode', backendInfo: info('deepseek-3.2') });
    await assert.rejects(runJudging({ ...f.common, judges: ['gpt-test'], caller: async ({ prompt }) => ({ text: reply(prompt), credits: 0.1 }) }), /already judged on the opencode backend.*cannot add kiro judgments/s);
    await runJudging({ ...f.common, judges: ['glm-5'], caller: usdStub(), backend: 'opencode', backendInfo: info('glm-5') });
    assert.deepEqual(JSON.parse(fs.readFileSync(path.join(f.runDir, 'judgments.json'), 'utf8')).judges, ['deepseek-3.2', 'glm-5']);
  } finally { f.cleanup(); }
});

test('the argv size limit applies to the kiro path only', async () => {
  const check = (v) => ({ ok: true, value: v });
  const caller = async () => ({ text: '{"a":1}', credits: 0 });
  const big = 'x'.repeat(130000);
  assert.match((await judgeOnce({ caller, model: 'm', prompt: big, check })).error, /prompt too large for one argument/);
  assert.equal((await judgeOnce({ caller, model: 'm', prompt: big, check, maxPromptBytes: Infinity })).error, undefined);
});

test('panel rules run on the logical ids; the GPT subject swaps luna for qwen and every id maps to Bedrock', () => {
  const r = resolveJudges({ subjectModel: 'gpt-5.6-sol' });
  assert.deepEqual(r.judges, ['deepseek-3.2', 'glm-5', 'qwen3-coder-next']);
  assert.deepEqual(r.substituted.dropped, ['gpt-5.6-luna']);
  assert.doesNotThrow(() => checkOpencodeJudges(r.judges));
  assert.deepEqual(r.judges.map((j) => opencodeModel(j).bedrockId), ['deepseek.v3.2', 'zai.glm-5', 'qwen.qwen3-coder-next']);
  const claude = resolveJudges({ subjectModel: 'claude-sonnet-5.5' });
  assert.deepEqual(claude.judges, ['gpt-5.6-luna', 'deepseek-3.2', 'glm-5']);
  assert.throws(() => resolveJudges({ cliJudges: 'gpt-5.6-luna,gpt-5.6-sol,glm-5', subjectModel: 'claude-sonnet-5.5' }), /both gpt models/);
  assert.throws(() => resolveJudges({ cliJudges: 'claude-sonnet-4.6,glm-5,deepseek-3.2', subjectModel: 'gpt-5.6-sol' }), /Claude model/);
  assert.throws(() => resolveJudges({ cliJudges: 'gpt-5.6-luna,glm-5,deepseek-3.2', subjectModel: 'gpt-5.6-sol' }), /same family as the subject/);
  assert.throws(() => resolveJudges({ cliJudges: 'glm-5,deepseek-3.2', subjectModel: 'claude-sonnet-5.5' }), /at least 3 are required/);
});
