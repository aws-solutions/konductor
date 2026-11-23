// SPDX-License-Identifier: Apache-2.0
'use strict';

// Every harness in HARNESSES against the adapter contract in harness/CONTRACT.md, through the plugin kit's checks
// (bench/kit/plugin/check.js): the member lists are read from the document, and parseResult runs on each plugin's
// recorded single-turn stream (one tool call, one final answer). Since FW-18 every harness is a plugin under
// bench/plugins/<name>/ with its own test/conformance.js, so there are no built-in cases left.

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { tmp, write } = require('./helpers.js');
const { HARNESSES } = require('../lib/harness/index.js');
const { REGISTRY } = require('../lib/harness/descriptors.js');
const { checkHarnessPlugin, contractMembers } = require('../../kit/plugin/check.js');

const REQUIRED = contractMembers('Required members');
const OPTIONAL = contractMembers('Optional members');
const PLUGINS = new Map(REGISTRY.parts('harness').filter((p) => p.source === 'plugin').map((p) => [p.name, p.plugin]));

test('every harness is a plugin, and every plugin passes the kit', () => {
  assert.deepEqual([...PLUGINS.keys()].sort(), Object.keys(HARNESSES).sort());
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

// Pilot wave 3: two kiro-cli runs ended after 11 s on a ClientThrottleError runError. The harness records it as the
// run error and flags the run `throttled`, so the pilot table reports a rerun instead of a too-hard task.
test('kiro-cli: a runError in the stream sets meta.runError, and a throttle also flags the run', () => {
  const harness = HARNESSES['kiro-cli'];
  const testDir = path.join(PLUGINS.get('kiro-cli').dir, 'test');
  const c = require(path.join(testDir, 'conformance.js'));
  const base = fs.readFileSync(path.join(testDir, c.fixture), 'utf8').trimEnd();
  for (const [message, flagged] of [["You're sending requests faster than your rate limit allows. ClientThrottleError", true], ['model refused the request', false]]) {
    const root = tmp();
    try {
      const streamText = `${base}\n${JSON.stringify({ type: 'runError', data: { stage: 'prompt', message } })}\n`;
      const home = path.join(root, 'home');
      const outDir = path.join(root, 'out');
      write(path.join(outDir, 'stream.jsonl'), streamText);
      const ctx = { envKeep: [], skillInfo: new Map(), ...c.setup({ root, home }) };
      const acc = { agg: null, session: null, checks: [], transcript: null, meta: { flags: [] } };
      harness.parseResult(outDir, { home, acc, arm: { id: 'kiro-cli-vanilla', vanilla: true, runtime: 'kiro-cli' }, ctx, config: c.config });
      assert.equal(acc.meta.runError, message);
      assert.equal(acc.meta.flags.includes('throttled'), flagged);
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  }
});
