// SPDX-License-Identifier: Apache-2.0
'use strict';

// Every harness in HARNESSES against the adapter contract in harness/CONTRACT.md: the member lists are read from the
// document, and parseResult runs on one recorded single-turn stream (one tool call, one final answer).
// A new runtime adds one fixture under fixtures/harness-contract/ and one row to CASES.

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { tmp, write } = require('./helpers.js');
const { makeFakeOpencode } = require('./fake-opencode.js');
const { HARNESSES } = require('../lib/harness/index.js');
const { isUsdRuntime } = require('../lib/harness/runtime.js');

const FX = path.join(__dirname, 'fixtures', 'harness-contract');
const CONTRACT = fs.readFileSync(path.join(__dirname, '..', 'lib', 'harness', 'CONTRACT.md'), 'utf8');

// First-column member names of the table under a "## <title>" heading.
function members(title) {
  const start = CONTRACT.indexOf(`\n## ${title}\n`);
  assert.ok(start >= 0, `CONTRACT.md has no "${title}" section`);
  const rest = CONTRACT.slice(start + 1);
  const end = rest.indexOf('\n## ', 3);
  const body = end < 0 ? rest : rest.slice(0, end);
  return [...body.matchAll(/^\| `([A-Za-z]+)/gm)].map((m) => m[1]);
}
const REQUIRED = members('Required members');
const OPTIONAL = members('Optional members');

// `setup` writes whatever the harness reads besides stream.jsonl and returns the ctx for parseResult.
const CASES = {
  'kiro-cli': {
    config: { model: 'claude-sonnet-5.5', effort: 'high', agentEngine: 'v2' },
    setup({ home, sessionId }) {
      const dir = path.join(home, '.kiro', 'sessions', 'cli');
      const turn = { model: 'claude-sonnet-5.5', total_request_count: 2, metering_usage: [{ value: 0.02, unit: 'credit' }] };
      write(path.join(dir, `${sessionId}.json`), JSON.stringify({ session_state: { conversation_metadata: { user_turn_metadatas: [turn] } } }));
      write(path.join(dir, `${sessionId}.jsonl`), '{"kind":"Prompt"}\n');
      return {};
    },
  },
  opencode: {
    config: { model: 'global.anthropic.claude-sonnet-5-5', effort: 'low' },
    setup({ root }) {
      const bin = makeFakeOpencode(path.join(root, 'bin'), { rowsFile: path.join(FX, 'opencode.rows.json') });
      return { opencode: { bin, version: '1.19.5', sha256: 'x' }, awsProfile: 'bench' };
    },
  },
  'claude-code': {
    config: { model: 'us.anthropic.claude-sonnet-5-5', canonicalModel: 'claude-sonnet-5-5', effort: 'default' },
    setup: () => ({ claude: { version: '9.9.9' } }),
  },
};

test('every harness has a fixture case, and every case names a harness', () => {
  assert.deepEqual(Object.keys(CASES).sort(), Object.keys(HARNESSES).sort());
  for (const id of Object.keys(HARNESSES)) assert.ok(fs.existsSync(path.join(FX, `${id}.jsonl`)), `missing fixtures/harness-contract/${id}.jsonl`);
});

test('CONTRACT.md lists the members this test checks', () => {
  for (const name of ['id', 'prepareArm', 'trialInstall', 'installInto', 'buildCommand', 'env', 'removeCredentials', 'keepPaths', 'turnSummary', 'parseResult', 'collectArtifacts']) {
    assert.ok(REQUIRED.includes(name), `required table lost ${name}`);
  }
  for (const name of ['requiredPaths', 'orchMetrics', 'finalize', 'secrets', 'cleanupRun', 'describeCleanup']) {
    assert.ok(OPTIONAL.includes(name), `optional table lost ${name}`);
  }
});

for (const [key, harness] of Object.entries(HARNESSES)) {
  test(`${key}: required members exist, optional members are absent or well-formed`, () => {
    assert.equal(typeof harness.id, 'string');
    assert.equal(harness.id, key, 'id must match its HARNESSES key');
    for (const name of REQUIRED.filter((n) => n !== 'id')) assert.equal(typeof harness[name], 'function', `${key}.${name} must be a function`);
    for (const name of OPTIONAL) {
      if (harness[name] === undefined) continue;
      if (name === 'requiredPaths') assert.ok(Array.isArray(harness.requiredPaths) && harness.requiredPaths.every((p) => typeof p === 'string'), `${key}.requiredPaths must be a string array`);
      else assert.equal(typeof harness[name], 'function', `${key}.${name} must be a function when present`);
    }
    if (harness.cleanupRun) assert.equal(typeof harness.describeCleanup, 'function', 'describeCleanup is required when cleanupRun is defined');
  });

  test(`${key}: parseResult fills acc from a recorded single-turn stream`, () => {
    const c = CASES[key];
    assert.ok(c, `add a CASES row for ${key}`);
    const root = tmp();
    try {
      const streamText = fs.readFileSync(path.join(FX, `${key}.jsonl`), 'utf8');
      const turn = harness.turnSummary(streamText);
      assert.equal(typeof turn.sessionId, 'string');
      assert.equal(turn.runFinishedStatus, 'success');
      assert.ok(turn.finalText, 'turnSummary must return the final answer');

      const home = path.join(root, 'home');
      const outDir = path.join(root, 'out');
      write(path.join(outDir, 'stream.jsonl'), streamText);
      fs.mkdirSync(path.join(root, 'tmp'), { recursive: true });
      const ctx = { envKeep: [], skillInfo: new Map(), ...c.setup({ root, home, sessionId: turn.sessionId }) };
      const acc = { agg: null, session: null, checks: [], transcript: null, meta: { flags: [] } };
      harness.parseResult(outDir, { home, tmpdir: path.join(root, 'tmp'), acc, arm: { id: `${key}-vanilla`, vanilla: true, runtime: key }, ctx, config: c.config });

      const a = acc.agg;
      assert.ok(a, 'acc.agg must be set');
      assert.equal(typeof a.sessionId, 'string');
      assert.ok(Array.isArray(a.sessionIds) && a.sessionIds.includes(a.sessionId));
      assert.equal(a.runFinishedStatus, 'success');
      assert.ok(a.stopReason === null || typeof a.stopReason === 'string');
      assert.ok(typeof a.finalText === 'string' && a.finalText.length > 0 && a.finalText.length <= 20000);
      assert.equal(typeof a.finalTextTruncated, 'boolean');
      assert.ok(Number.isInteger(a.toolCalls) && a.toolCalls >= 1, 'the fixture has one tool call');
      assert.equal(typeof a.toolNames, 'object');
      assert.ok(Object.keys(a.toolNames).length >= 1);
      assert.ok(Number.isInteger(a.subagentCalls) && a.subagentCalls === 0);
      assert.equal(a.workToolCalls, a.toolCalls - a.subagentCalls);
      assert.equal(typeof a.delegatedTo, 'object');
      assert.equal(typeof a.credits, 'number');
      assert.equal(typeof a.meteringEntries, 'number');
      assert.ok(Array.isArray(a.nonCreditUnits));
      assert.ok(a.skillsMcpOk === null || typeof a.skillsMcpOk === 'boolean');
      assert.ok(a.askedUser === null || typeof a.askedUser === 'boolean');
      assert.ok(a.turnDurationMs === null || typeof a.turnDurationMs === 'number');
      assert.ok(a.contextUsagePercentage === null || typeof a.contextUsagePercentage === 'number');

      assert.ok(acc.session, 'acc.session must be set');
      assert.equal(typeof acc.session.model, 'string');
      assert.ok(Number.isInteger(acc.session.totalRequestCount) && acc.session.totalRequestCount >= 1);

      const t = acc.transcript;
      assert.ok(t && t.bytes > 0 && t.chars > 0 && typeof t.partial === 'boolean', 'acc.transcript must be { bytes, chars, partial }');
      assert.ok(acc.skills, 'acc.skills must be set');
      assert.ok(Array.isArray(acc.meta.flags));
      assert.ok(!acc.meta.flags.includes('usageUnavailable'), 'the usage source must be readable');

      if (isUsdRuntime(key)) {
        assert.equal(a.credits, 0);
        assert.equal(a.meteringEntries, 0);
        const u = acc.usage;
        assert.ok(u, 'a USD runtime must set acc.usage');
        for (const k of ['input', 'output', 'reasoning', 'cacheRead', 'cacheWrite', 'total']) assert.equal(typeof u.tokens[k], 'number', `usage.tokens.${k}`);
        assert.ok(typeof u.costUsd === 'number' && u.costUsd > 0);
        assert.ok(Number.isInteger(u.modelCalls) && Number.isInteger(u.sessions));
        assert.ok(Array.isArray(u.variants));
      } else {
        assert.ok(a.credits > 0 && a.meteringEntries > 0, 'a credit runtime must report credits');
        assert.equal(acc.usage, undefined, 'a credit runtime leaves acc.usage unset');
      }
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });
}
