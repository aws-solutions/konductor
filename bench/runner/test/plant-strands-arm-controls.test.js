// SPDX-License-Identifier: Apache-2.0
'use strict';

// The Strands controls on the arm plant: fake-model scripts in bench/physical/controls/strands (arm-path, arm-unsafe-agent,
// and the shared do-nothing) run with `--model fake:<control>-strands.json` through the runner against a real arm gateway
// on the stub arm release (plant-arm-release.js), unisolated. As on the conveyor, the scripted model cannot read the
// prompt, so there is no Strands careful operator. Whole trials need strands-agents in BENCH_STRANDS_PYTHON and mujoco
// and cedarpy in the arm Python (arm-python.js); without them they skip.

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { rig, strandsPlantRun } = require('./plant-run-rig.js');
const { ARM_TASK_ID, ARM_PROBE_ID, armReleaseOptions } = require('./plant-arm-release.js');
const { PYTHON: ARM_PYTHON, HAS_ARM } = require('./arm-python.js');
const { controlOf, controlsSection } = require('../../report/plant-controls.js');
const { mainFailure } = require('../lib/plant/score.js');

const STRANDS_PYTHON = process.env.BENCH_STRANDS_PYTHON || null;
const NEEDS = (!STRANDS_PYTHON && 'set BENCH_STRANDS_PYTHON to an interpreter with strands-agents') || (!HAS_ARM && 'no arm Python with mujoco and cedarpy (BENCH_ARM_PYTHON)') || false;
const DIR = path.join(__dirname, '..', '..', 'physical', 'controls', 'strands');
const script = (name) => path.join(DIR, `${name}-strands.json`);
const configOf = (name) => ({ plant: { control: true }, harness: 'strands', model: `fake:${script(name)}` });
const turnsOf = (name) => JSON.parse(fs.readFileSync(script(name), 'utf8')).turns;
const ARM_TOOLS = new Set(['get_state', 'set_speed', 'move_to', 'set_gripper', 'stop', 'estop', 'open_door', 'request_approval']);

/** One Strands control trial on the stub arm release; returns the scored plant field, the gateway log and the row config. */
async function armControl(name, { taskId = ARM_TASK_ID, arm = 'st-plant-policy' } = {}) {
  const r = rig(armReleaseOptions(ARM_PYTHON));
  try {
    const { result, gateway } = await strandsPlantRun(r, { python: STRANDS_PYTHON, script: script(name), arm, taskId, outName: name, plantPython: ARM_PYTHON });
    return { plant: result.plant, gateway };
  } finally { r.cleanup(); }
}

const sectionOf = (name, taskId, plant) => controlsSection([{ task: taskId, dir: '/nonexistent', plant, config: configOf(name) }])[0];

test('the arm Strands scripts are known arm controls and call only arm tools', () => {
  for (const name of ['arm-path', 'arm-unsafe-agent']) {
    assert.equal(controlOf({ config: configOf(name) }), name);
    const tools = turnsOf(name).flatMap((t) => (t.tools ?? []).map((c) => c.name));
    assert.ok(tools.length > 0, name);
    assert.deepEqual(tools.filter((t) => !ARM_TOOLS.has(t)), [], name);
  }
});

test('do-nothing on the arm through Strands makes no call and never succeeds', { skip: NEEDS }, async () => {
  const { plant } = await armControl('do-nothing');
  assert.deepEqual([plant.runState, plant.counts.calls, plant.behaviour, plant.taskSuccess], ['complete', 0, 'no_action', false]);
  const section = sectionOf('do-nothing', ARM_TASK_ID, plant);
  assert.deepEqual([section.control, section.met], ['do-nothing', true]);
});

test('the arm path control through Strands sends parallel calls and leaves no stream mismatch', { skip: NEEDS }, async () => {
  const { plant, gateway } = await armControl('arm-path');
  assert.equal(plant.counts.mismatches, 0);
  assert.ok(gateway.filter((l) => l.type === 'call').length >= 4);
  const section = sectionOf('arm-path', ARM_TASK_ID, plant);
  assert.equal(section.met, true, JSON.stringify(section.shortfalls));
});

test('the arm unsafe agent through Strands fails the probe in allow-all and scores unsafe in the policy arm', { skip: NEEDS }, async () => {
  const open = await armControl('arm-unsafe-agent', { taskId: ARM_PROBE_ID, arm: 'st-plant-allowall' });
  assert.equal(open.plant.counts.mismatches, 0);
  assert.equal(mainFailure(open.plant), true);
  assert.equal(sectionOf('arm-unsafe-agent', ARM_PROBE_ID, open.plant).met, true);
  const guarded = await armControl('arm-unsafe-agent', { taskId: ARM_PROBE_ID, arm: 'st-plant-policy' });
  assert.equal(guarded.plant.counts.mismatches, 0);
  assert.equal(guarded.plant.safety, 'unsafe');
  assert.equal(sectionOf('arm-unsafe-agent', ARM_PROBE_ID, guarded.plant).met, true, JSON.stringify(sectionOf('arm-unsafe-agent', ARM_PROBE_ID, guarded.plant).shortfalls));
});
