// SPDX-License-Identifier: Apache-2.0
'use strict';

// Judge passes (FW-6, DEBT D-200): each judgment records the judge model version and the pass it came from, and compare
// refuses to set two passes side by side unless asked to (--allow-mixed-pass), because judge drift between passes is noise
// the comparison would read as an effect.

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { tmp, makeBench, makeRun } = require('./helpers.js');
const { buildStudy } = require('./rubric-policy-fixture.js');
const { compareRuns, formatCompare } = require('../../report/compare.js');
const { runJudging, passIdOf } = require('../../judge/run.js');
const { DEFAULT_REDACTIONS, compileRedactions } = require('../../judge/redact.js');

const rm = (d) => fs.rmSync(d, { recursive: true, force: true });

function setPass(dir, passId) {
  const file = path.join(dir, 'judgments.json');
  const j = JSON.parse(fs.readFileSync(file, 'utf8'));
  j.rubric = j.rubric.map((r) => ({ ...r, passId }));
  fs.writeFileSync(file, JSON.stringify(j));
}

test('two fixture sets from different passes are refused; one pass compares', () => {
  const root = tmp();
  try {
    const base = buildStudy(root, 'base');
    const head = buildStudy(root, 'head');
    setPass(base.dir, '2026-11-21.aaaaaaaa');
    setPass(head.dir, '2026-11-23.aaaaaaaa');
    const mixed = compareRuns({ baseDir: base.dir, headDir: head.dir, benchDir: head.bench });
    assert.equal(mixed.exitCode, 2);
    assert.match(formatCompare(mixed), /judge passes differ: base "2026-11-21\.aaaaaaaa" vs head "2026-11-23\.aaaaaaaa"/);

    const allowed = compareRuns({ baseDir: base.dir, headDir: head.dir, benchDir: head.bench, allowMixedPass: true });
    assert.equal(allowed.refusals.length, 0);
    assert.notEqual(allowed.exitCode, 2);
    assert.match(formatCompare(allowed), /^Mixed judge passes \(--allow-mixed-pass\): base "2026-11-21\.aaaaaaaa" vs head "2026-11-23\.aaaaaaaa"/m);

    setPass(head.dir, '2026-11-21.aaaaaaaa');
    const one = compareRuns({ baseDir: base.dir, headDir: head.dir, benchDir: head.bench });
    assert.equal(one.refusals.length, 0);
    assert.doesNotMatch(formatCompare(one), /judge pass/i);
  } finally { rm(root); }
});

test('studies judged before passes were recorded still compare; a recorded pass against an unrecorded one does not', () => {
  const root = tmp();
  try {
    const base = buildStudy(root, 'base');
    const head = buildStudy(root, 'head');
    assert.equal(compareRuns({ baseDir: base.dir, headDir: head.dir, benchDir: head.bench }).refusals.length, 0);
    setPass(head.dir, '2026-11-23.aaaaaaaa');
    const r = compareRuns({ baseDir: base.dir, headDir: head.dir, benchDir: head.bench });
    assert.match(r.refusals.join('\n'), /judge passes differ: base "unrecorded" vs head "2026-11-23\.aaaaaaaa"/);
  } finally { rm(root); }
});

test('a pass id is the UTC day and a hash of the backend and judge model versions', () => {
  const at = new Date('2026-11-23T23:59:00Z');
  const a = passIdOf({ backend: 'kiro', versions: { 'glm-5': 'glm-5', 'gpt-5': 'gpt-5' }, at });
  assert.match(a, /^2026-11-23\.[0-9a-f]{8}$/);
  assert.equal(passIdOf({ backend: 'kiro', versions: { 'gpt-5': 'gpt-5', 'glm-5': 'glm-5' }, at }), a, 'order of judges does not matter');
  assert.notEqual(passIdOf({ backend: 'opencode', versions: { 'glm-5': 'glm-5', 'gpt-5': 'gpt-5' }, at }), a);
  assert.notEqual(passIdOf({ backend: 'kiro', versions: { 'glm-5': 'glm-5.1', 'gpt-5': 'gpt-5' }, at }), a);
  assert.notEqual(passIdOf({ backend: 'kiro', versions: { 'glm-5': 'glm-5', 'gpt-5': 'gpt-5' }, at: new Date('2026-11-24T00:01:00Z') }), a);
});

test('every judgment and the invocation record the pass id and the judge model version', async () => {
  const root = tmp();
  try {
    const bench = makeBench(path.join(root, 'bench'));
    const runDir = makeRun(path.join(root, 'run'), bench, [{ arm: 'vanilla', rep: 1 }, { arm: 'v1', rep: 1 }]);
    const caller = async ({ prompt }) => (prompt.includes('=== RESPONSE A ===')
      ? { text: JSON.stringify({ winner: 'A', reason: 'r' }), credits: 0, latencyMs: 1 }
      : { text: JSON.stringify({ criteria: [...prompt.matchAll(/^- id: (\S+)/gm)].map((m) => ({ id: m[1], verdict: 'pass', evidence: 'a.txt' })) }), credits: 0, latencyMs: 1 });
    const j = await runJudging({
      runDir, benchDir: bench, judges: ['gpt-test', 'deepseek-test', 'glm-test'], modes: ['rubric', 'pairwise'], baseline: 'vanilla', concurrency: 1, budgetCredits: null, caller,
      limits: { maxFileChars: 6000, maxBundleChars: 24000 }, redactions: compileRedactions(DEFAULT_REDACTIONS), log: () => {},
      backendInfo: { models: { 'gpt-test': { bedrockModelId: 'openai.gpt-test-v1:0' } } },
    });
    const recs = [...j.rubric, ...j.pairwise];
    assert.ok(recs.length > 0);
    const ids = new Set(recs.map((r) => r.passId));
    assert.equal(ids.size, 1);
    const [passId] = ids;
    assert.match(passId, /^\d{4}-\d{2}-\d{2}\.[0-9a-f]{8}$/);
    assert.equal(j.invocations.at(-1).passId, passId);
    for (const r of recs) assert.equal(r.judgeModelVersion, r.judge === 'gpt-test' ? 'openai.gpt-test-v1:0' : r.judge);
  } finally { rm(root); }
});
