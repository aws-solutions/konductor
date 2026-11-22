// SPDX-License-Identifier: Apache-2.0
'use strict';

// The Strands plant controls (DEBT D-113): fake-model scripts in bench/physical/controls/strands, run with
// `--model fake:<control>-strands.json` on a real gateway and stub tasks (--isolate none). The scripted model cannot
// read the prompt, so only the task-independent controls exist: do-nothing, path and unsafe-agent. Whole trials need
// an interpreter with strands-agents in BENCH_STRANDS_PYTHON and are skipped without one.

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { rig, strandsPlantRun } = require('./plant-run-rig.js');
const { STUB_RELEASE } = require('./plant-control-stubs.js');
const { TASK_ID } = require('./plant-release-fixture.js');
const { controlOf, controlsSection, CONTROLS: REPORT_CONTROLS } = require('../../report/plant-controls.js');
const { mainFailure } = require('../lib/plant/score.js');

const STRANDS_PYTHON = process.env.BENCH_STRANDS_PYTHON || null;
const NEEDS_STRANDS = STRANDS_PYTHON ? false : 'set BENCH_STRANDS_PYTHON to an interpreter with strands-agents';
const DIR = path.join(__dirname, '..', '..', 'physical', 'controls', 'strands');
const script = (name) => path.join(DIR, `${name}-strands.json`);
const configOf = (name) => ({ plant: { control: true }, harness: 'strands', model: `fake:${script(name)}` });

async function controlTrial(name, { taskId = TASK_ID, arm = 'st-plant-policy' } = {}) {
  const r = rig(STUB_RELEASE);
  try {
    const { result, gateway } = await strandsPlantRun(r, { python: STRANDS_PYTHON, script: script(name), arm, taskId, outName: name });
    return { result, plant: result.plant, gateway };
  } finally { r.cleanup(); }
}

test('every Strands control script is a known control with turns, and none reads the prompt', () => {
  const files = fs.readdirSync(DIR).filter((f) => f.endsWith('-strands.json')).sort();
  assert.deepEqual(files, ['do-nothing-strands.json', 'path-strands.json', 'unsafe-agent-strands.json']);
  for (const f of files) {
    assert.ok(Object.hasOwn(REPORT_CONTROLS, f.replace(/-strands\.json$/, '')), f);
    assert.ok(Array.isArray(JSON.parse(fs.readFileSync(path.join(DIR, f), 'utf8')).turns), f);
  }
});

test('the report names a Strands control suite by its fake-model script, and a plain fake script or a real model is no control', () => {
  assert.equal(controlOf({ config: configOf('do-nothing') }), 'do-nothing');
  assert.equal(controlOf({ config: configOf('unsafe-agent') }), 'unsafe-agent');
  assert.equal(controlOf({ config: { plant: { control: true }, model: 'fake:/tmp/script.json' } }), null);
  assert.equal(controlOf({ config: { plant: { control: false }, model: 'bedrock:us.anthropic.claude-sonnet-5-5' } }), null);
});

test('do-nothing on Strands makes no call, and the report section says it met its expectation', { skip: NEEDS_STRANDS }, async () => {
  const { plant } = await controlTrial('do-nothing');
  assert.equal(plant.runState, 'complete');
  assert.equal(plant.counts.calls, 0);
  assert.equal(plant.behaviour, 'no_action');
  const [section] = controlsSection([{ task: TASK_ID, dir: '/nonexistent', plant, config: configOf('do-nothing') }]);
  assert.deepEqual([section.control, section.met], ['do-nothing', true]);
});

test('the path control on Strands sends parallel calls and leaves no mismatch', { skip: NEEDS_STRANDS }, async () => {
  const { plant, gateway } = await controlTrial('path');
  assert.equal(plant.counts.mismatches, 0);
  assert.ok(gateway.filter((l) => l.type === 'call').length >= 3);
  const [section] = controlsSection([{ task: TASK_ID, dir: '/nonexistent', plant, config: configOf('path') }]);
  assert.equal(section.met, true, JSON.stringify(section.shortfalls));
});

test('the unsafe agent on Strands fails an R2 probe in allow-all', { skip: NEEDS_STRANDS }, async () => {
  const { plant } = await controlTrial('unsafe-agent', { taskId: 'plant-stub-probe.v01', arm: 'st-plant-allowall' });
  assert.equal(plant.counts.mismatches, 0);
  assert.equal(mainFailure(plant), true);
});
