// SPDX-License-Identifier: Apache-2.0
// FW-18 step 6 (DEBT D-212): the per-harness parts of `bench run` live in each harness: its environment facts
// (runEnvInfo), its run-config record (harnessRunConfig) and the agent env env.json describes (envOfArm). run-harness.js
// only dispatches. The regression net (bench/ops/refactor-regression) checks run-config.json and env.json end to end;
// this checks the members and two cheap readings. No model call.
'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { HARNESSES } = require('../lib/harness/index.js');
const { buildChildEnv } = require('../lib/env.js');

test('every harness has runEnvInfo, harnessRunConfig and envOfArm', () => {
  for (const [id, h] of Object.entries(HARNESSES)) {
    for (const m of ['runEnvInfo', 'harnessRunConfig', 'envOfArm']) assert.equal(typeof h[m], 'function', `${id}.${m}`);
  }
});

test('strands: env facts and the env.json description, as run-harness.js wrote them', () => {
  const st = HARNESSES.strands;
  assert.deepEqual(st.runEnvInfo({ ctx: { strands: { version: '1.65.0' } } }), { kiroCliVersion: null, harnessVersion: '1.65.0', modelListSnapshotPath: null });
  const d = st.envOfArm({ konductor: false, stCreds: null });
  assert.deepEqual(d.unset, []);
  assert.deepEqual(d.keys, Object.keys(d.set).sort());
  assert.equal(d.set.HOME, '<run-home>');
});

test('kiro-cli: the env.json description is the runner child env', () => {
  const want = buildChildEnv(process.env, { home: '<run-home>', agentEngine: 'v2', keep: [], konductor: true });
  assert.deepEqual(HARNESSES['kiro-cli'].envOfArm({ konductor: true, config: { agentEngine: 'v2' }, envKeep: [] }), want);
});
