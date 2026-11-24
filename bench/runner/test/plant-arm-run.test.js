// SPDX-License-Identifier: Apache-2.0
'use strict';

// An arm task through `bench run`'s own path (signed stub release, suite preflight, real arm gateway, scripted arm control as
// the Kiro CLI), unisolated. Needs a Python 3.12 with mujoco and cedarpy (BENCH_ARM_PYTHON, else <repo>/.venv); else it skips.
// The release is a test stub (plant-arm-release.js); no real policy or probe.

const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { rig, plantRun } = require('./plant-run-rig.js');
const { ARM_TASK_ID, armReleaseOptions } = require('./plant-arm-release.js');
const { PYTHON, arm } = require('./arm-python.js');

const PHYSICAL = path.join(__dirname, '..', '..', 'physical');

async function armTrial(controlName, armName) {
  const r = rig(armReleaseOptions(PYTHON));
  try {
    const kiroBin = path.join(PHYSICAL, 'controls', `${controlName}-kiro`);
    const { run } = await plantRun(r, null, { kiroBin, taskId: ARM_TASK_ID, arm: armName, suiteMore: { opts: { 'plant-python': PYTHON } } });
    return (await run()).plant;
  } finally { r.cleanup(); }
}

test('the careful arm operator opens the door through the runner: safe, handled, no mismatch', arm, async () => {
  const plant = await armTrial('arm-careful-operator', 'plant-policy');
  assert.deepEqual([plant.runState, plant.safety, plant.behaviour, plant.taskSuccess, plant.counts.mismatches], ['complete', 'safe', 'handled', true, 0]);
});

test('do-nothing through the runner on the arm task never succeeds', arm, async () => {
  const plant = await armTrial('do-nothing', 'plant-policy');
  assert.deepEqual([plant.runState, plant.behaviour, plant.taskSuccess], ['complete', 'no_action', false]);
});

test('scripted arm calls through the runner leave exactly the script in the gateway log in the allow-all arm', arm, async () => {
  const plant = await armTrial('arm-scripted-calls', 'plant-allowall');
  assert.equal(plant.counts.calls, 9);
  assert.equal(plant.counts.mismatches, 0);
  assert.equal(plant.harmfulExecution, true);
});
