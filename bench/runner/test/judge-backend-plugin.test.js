// SPDX-License-Identifier: Apache-2.0
'use strict';

// FW-14 (DEBT D-208): judge backends are registry parts of kind judge-backend. The built-in is kiro (credits); opencode
// (USD) is a part of bench/plugins/opencode (B-014); a plugin under bench/plugins adds one with a descriptor and a makeCaller entry. checkBackend is the one
// check of a backend and its budget flag that judge/run.js, judge/packrun.js and the judge CLI share.

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { tmp, write, makeBench, makeRun } = require('./helpers.js');
const { backendRegistry, checkBackend, makeBackendCaller } = require('../../judge/backends.js');
const { runJudging } = require('../../judge/run.js');
const { compileRedactions, DEFAULT_REDACTIONS } = require('../../judge/redact.js');
const { readLedger } = require('../lib/credit-ledger.js');

const PLUGINS = path.join(__dirname, '..', '..', 'plugins');

// A judge-backend plugin folder whose caller answers every rubric criterion "pass" at USD 0.001 a call.
function fakePlugin(root) {
  const dir = path.join(root, 'fake-be');
  write(path.join(dir, 'plugin.json'), JSON.stringify({ benchApi: 1, kind: 'judge-backend', name: 'fake-be', version: '0.1.0', meta: 'meta.js', entry: 'backend.js' }));
  write(path.join(dir, 'meta.js'), "module.exports = Object.freeze({ id: 'fake-be', costUnit: 'usd', label: 'a fake backend, spend in USD' });\n");
  write(path.join(dir, 'backend.js'), [
    'exports.makeCaller = ({ timeoutMs }) => async ({ prompt }) => {',
    "  const ids = [...prompt.matchAll(/^- id: (\\S+)/gm)].map((m) => m[1]);",
    "  return { text: JSON.stringify({ criteria: ids.map((id) => ({ id, verdict: 'pass', evidence: 'a.txt' })) }), credits: 0, usd: 0.001, latencyMs: timeoutMs > 0 ? 1 : 0 };",
    '};',
    '',
  ].join('\n'));
  return root;
}

test('kiro (built-in) counts credits, opencode (plugin part) USD; the wrong budget flag and an unknown backend are refused by one check', () => {
  assert.deepEqual(backendRegistry([]).ids(), ['kiro'], 'kiro is the one built-in');
  const reg = backendRegistry([PLUGINS]);
  assert.deepEqual(reg.ids(), ['kiro', 'opencode']);
  assert.deepEqual(checkBackend({}, reg), { backend: 'kiro', usdMode: false, unit: 'credits', part: reg.part('kiro') });
  assert.equal(checkBackend({ backend: 'opencode', budgetUsd: 1 }, reg).usdMode, true);
  assert.throws(() => checkBackend({ backend: 'opencode', budgetCredits: 5 }, reg), /--budget-credits does not apply to the opencode backend; use --budget-usd/);
  assert.throws(() => checkBackend({ backend: 'kiro', budgetUsd: 1 }, reg), /--budget-usd applies to the opencode backend only; use --budget-credits/);
  assert.throws(() => checkBackend({ backend: 'nope' }, reg), /unknown judge backend "nope": --judge-backend takes kiro or opencode/);
});

test('a fake backend plugin loads, passes the check and judges a run with its USD spend on the ledger', async () => {
  const root = tmp();
  try {
    const reg = backendRegistry([PLUGINS, fakePlugin(path.join(root, 'plugins'))]);
    assert.deepEqual(reg.ids(), ['kiro', 'opencode', 'fake-be']);
    assert.equal(reg.part('fake-be').source, 'plugin');
    const b = checkBackend({ backend: 'fake-be', budgetUsd: 1 }, reg);
    assert.equal(b.unit, 'usd');
    const caller = makeBackendCaller(b.part, { timeoutMs: 1000, rawDir: null });
    const bench = makeBench(path.join(root, 'bench'));
    const runDir = makeRun(path.join(root, 'run'), bench, [{ arm: 'vanilla', files: { 'a.txt': 'fixed\n' } }]);
    const j = await runJudging({
      runDir, benchDir: bench, judges: ['gpt-test', 'deepseek-test', 'glm-test'], modes: ['rubric'], baseline: 'vanilla', concurrency: 1,
      budgetCredits: null, budgetUsd: 1, caller, backend: 'fake-be', backendRegistry: reg,
      limits: { maxFileChars: 6000, maxBundleChars: 24000 }, redactions: compileRedactions(DEFAULT_REDACTIONS), log: () => {},
    });
    assert.equal(j.backend, 'fake-be');
    assert.ok(j.rubric.every((r) => r.judgeError === null && r.score === 1));
    assert.ok(Math.abs(j.spentUsd - 0.003) < 1e-9);
    assert.ok(Math.abs(readLedger(runDir).totals.usd - 0.003) < 1e-9);
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});

test('a plugin without makeCaller is refused when its caller is asked for', () => {
  const root = tmp();
  try {
    const dir = fakePlugin(path.join(root, 'plugins'));
    write(path.join(dir, 'fake-be', 'backend.js'), 'exports.other = 1;\n');
    const reg = backendRegistry([dir]);
    assert.throws(() => makeBackendCaller(reg.part('fake-be'), {}), /fake-be: its entry module exports no makeCaller/);
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});
