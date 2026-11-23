// SPDX-License-Identifier: Apache-2.0
'use strict';

// Every harness in HARNESSES against the adapter contract in harness/CONTRACT.md, through the plugin kit's checks
// (bench/kit/plugin/check.js): the member lists are read from the document, and parseResult runs on one recorded
// single-turn stream (one tool call, one final answer). A built-in adds one fixture under fixtures/harness-contract/
// and one row to CASES; a plugin ships its own stream and test/conformance.js.

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { tmp, write } = require('./helpers.js');
const { makeFakeOpencode } = require('./fake-opencode.js');
const { HARNESSES } = require('../lib/harness/index.js');
const { REGISTRY } = require('../lib/harness/descriptors.js');
const { memberProblems, streamProblems, checkHarnessPlugin, contractMembers } = require('../../kit/plugin/check.js');
const { isUsdRuntime } = require('../lib/harness/runtime.js');

const FX = path.join(__dirname, 'fixtures', 'harness-contract');

const REQUIRED = contractMembers('Required members');
const OPTIONAL = contractMembers('Optional members');

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
    config: { model: 'us.anthropic.claude-sonnet-5-5', canonicalModel: 'claude-sonnet-5-5', effort: 'high' },
    setup: () => ({ claude: { version: '9.9.9' } }),
  },

};

const PLUGINS = new Map(REGISTRY.parts('harness').filter((p) => p.source === 'plugin').map((p) => [p.name, p.plugin]));

test('every built-in harness has a fixture case, every case names one, and every plugin passes the kit', () => {
  assert.deepEqual(Object.keys(CASES).sort(), Object.keys(HARNESSES).filter((id) => !PLUGINS.has(id)).sort());
  for (const id of Object.keys(CASES)) assert.ok(fs.existsSync(path.join(FX, `${id}.jsonl`)), `missing fixtures/harness-contract/${id}.jsonl`);
  for (const [id, p] of PLUGINS) assert.deepEqual(checkHarnessPlugin(p.dir), [], id);
});

test('CONTRACT.md lists the members this test checks', () => {
  for (const name of ['id', 'prepareArm', 'trialInstall', 'installInto', 'buildCommand', 'env', 'removeCredentials', 'keepPaths', 'turnSummary', 'parseResult', 'collectArtifacts']) {
    assert.ok(REQUIRED.includes(name), `required table lost ${name}`);
  }
  for (const name of ['requiredPaths', 'credentialEnv', 'streams', 'orchMetrics', 'finalize', 'secrets', 'cleanupRun', 'describeCleanup']) {
    assert.ok(OPTIONAL.includes(name), `optional table lost ${name}`);
  }
});

for (const [key, harness] of Object.entries(HARNESSES).filter(([id]) => !PLUGINS.has(id))) {
  test(`${key}: required members exist, optional members are absent or well-formed`, () => {
    assert.deepEqual(memberProblems(key, harness), []);
  });

  test(`${key}: parseResult fills acc from a recorded single-turn stream`, () => {
    const c = CASES[key];
    assert.ok(c, `add a CASES row for ${key}`);
    const root = tmp();
    try {
      const streamText = fs.readFileSync(path.join(FX, `${key}.jsonl`), 'utf8');
      const ctx = c.setup({ root, home: path.join(root, 'home'), sessionId: harness.turnSummary(streamText).sessionId });
      assert.deepEqual(streamProblems({ id: key, harness, streamText, ctx, config: c.config, isUsd: isUsdRuntime(key), freeModel: Boolean(c.freeModel), root }), []);
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });
}

// Pilot wave 3: two kiro-cli runs ended after 11 s on a ClientThrottleError runError. The harness records it as the
// run error and flags the run `throttled`, so the pilot table reports a rerun instead of a too-hard task.
test('kiro-cli: a runError in the stream sets meta.runError, and a throttle also flags the run', () => {
  const harness = HARNESSES['kiro-cli'];
  const c = CASES['kiro-cli'];
  const base = fs.readFileSync(path.join(FX, 'kiro-cli.jsonl'), 'utf8').trimEnd();
  for (const [message, flagged] of [["You're sending requests faster than your rate limit allows. ClientThrottleError", true], ['model refused the request', false]]) {
    const root = tmp();
    try {
      const streamText = `${base}\n${JSON.stringify({ type: 'runError', data: { stage: 'prompt', message } })}\n`;
      const turn = harness.turnSummary(streamText);
      const home = path.join(root, 'home');
      const outDir = path.join(root, 'out');
      write(path.join(outDir, 'stream.jsonl'), streamText);
      const ctx = { envKeep: [], skillInfo: new Map(), ...c.setup({ root, home, sessionId: turn.sessionId }) };
      const acc = { agg: null, session: null, checks: [], transcript: null, meta: { flags: [] } };
      harness.parseResult(outDir, { home, acc, arm: { id: 'kiro-cli-vanilla', vanilla: true, runtime: 'kiro-cli' }, ctx, config: c.config });
      assert.equal(acc.meta.runError, message);
      assert.equal(acc.meta.flags.includes('throttled'), flagged);
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  }
});
