// SPDX-License-Identifier: Apache-2.0
'use strict';

// The scripted plant controls as Claude Code (DEBT D-113): each `<control>-claude` in bench/physical/controls runs the
// same control as its `-kiro` twin, but reads Claude Code's argv, MCP config and stdin prompt and writes a Claude Code
// stream. Trials run against a real gateway on stub tasks (--isolate none), and the plant report finds the suite.

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { rig, claudePlantRun, readJsonl } = require('./plant-run-rig.js');
const { TASK_ID } = require('./plant-release-fixture.js');
const { STUB_RELEASE } = require('./plant-control-stubs.js');
const { SIDE_FILE, controlOf, controlsSection } = require('../../report/plant-controls.js');
const { HARNESSES } = require('../lib/harness/index.js');
const cc = HARNESSES['claude-code'];
const { mainFailure } = require('../lib/plant/score.js');

const CONTROLS = path.join(__dirname, '..', '..', 'physical', 'controls');
const { SCRIPT } = require(path.join(CONTROLS, 'scripted-calls-kiro'));
const bin = (name) => path.join(CONTROLS, `${name}-claude`);
const KIRO_CONTROLS = fs.readdirSync(CONTROLS).filter((f) => f.endsWith('-kiro') && f !== 'wall-prober-kiro');

/** Runs Claude Code control `name` on `taskId` in `arm`; returns `{result, plant, side, gateway, stream, runConfig}`. */
async function controlTrial(name, { taskId = TASK_ID, arm = 'cc-plant-policy' } = {}) {
  const r = rig(STUB_RELEASE);
  try {
    const { result, outDir } = await claudePlantRun(r, bin(name), { arm, taskId });
    const side = JSON.parse(fs.readFileSync(path.join(outDir, 'workspace', SIDE_FILE), 'utf8'));
    return { result, plant: result.plant, side, outDir, gateway: readJsonl(path.join(outDir, 'plant', 'gateway.jsonl')), stream: fs.readFileSync(path.join(outDir, 'stream.jsonl'), 'utf8') };
  } finally { r.cleanup(); }
}

test('every Kiro CLI control has a Claude Code twin of the same control', () => {
  for (const kiro of KIRO_CONTROLS) {
    const twin = path.join(CONTROLS, kiro.replace(/-kiro$/, '-claude'));
    assert.ok(fs.existsSync(twin), `${twin} is missing`);
    assert.equal(fs.realpathSync(twin), fs.realpathSync(path.join(CONTROLS, kiro)));
  }
});

test('resolveClaude takes a bench plant control as a control binary, and still refuses any other small file', () => {
  const c = cc.resolveClaude({ binOverride: bin('do-nothing') });
  assert.equal(c.control, true);
  assert.equal(c.version, 'plant-control');
  const root = fs.mkdtempSync(path.join(require('node:os').tmpdir(), 'cc-ctl-'));
  try {
    const copy = path.join(root, 'do-nothing-claude');
    fs.copyFileSync(path.join(CONTROLS, 'do-nothing-kiro'), copy);
    fs.chmodSync(copy, 0o755);
    assert.throws(() => cc.resolveClaude({ binOverride: copy }), /launcher, not the claude binary/);
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});

test('the report names a Claude Code control suite by its claude binary', () => {
  const row = (name) => ({ config: { plant: { control: true }, claudeCode: { binaryName: name } } });
  assert.equal(controlOf(row('do-nothing-claude')), 'do-nothing');
  assert.equal(controlOf(row('arm-path-claude')), 'arm-path');
  assert.equal(controlOf(row('claude')), null);
});

test('do-nothing as Claude Code makes no call, scores no_action, and the report section says it met its expectation', async () => {
  const { plant, result } = await controlTrial('do-nothing');
  assert.equal(result.status, 'success', result.error);
  assert.equal(plant.runState, 'complete');
  assert.equal(plant.counts.calls, 0);
  assert.equal(plant.behaviour, 'no_action');
  const [section] = controlsSection([{ task: TASK_ID, dir: '/nonexistent', plant, config: { plant: { control: true }, claudeCode: { binaryName: 'do-nothing-claude' } } }]);
  assert.equal(section.control, 'do-nothing');
  assert.equal(section.met, true);
});

test('scripted-calls as Claude Code leaves exactly its script in the gateway log, with mcp__plant__ calls and no mismatch', async () => {
  const { plant, side, gateway, stream } = await controlTrial('scripted-calls');
  assert.equal(side.calls.length, SCRIPT.length);
  assert.deepEqual(gateway.filter((l) => l.type === 'call').map((l) => l.tool), SCRIPT.map(([tool]) => tool));
  assert.match(stream, /"name":"mcp__plant__/);
  assert.match(stream, /"type":"result"/);
  assert.equal(plant.counts.mismatches, 0);
  // The stub release has no Cedar policy, so plantPolicyGap is the one flag, as for the Kiro CLI control.
  assert.deepEqual(plant.flags, ['plantPolicyGap']);
});

test('the path control as Claude Code retries the call a dropped link cut and leaves no mismatch', async () => {
  const { plant, side } = await controlTrial('path', { taskId: 'plant-stub-drop.v01' });
  assert.equal(plant.counts.connectionLost, 1);
  assert.equal(side.retries, 1);
  assert.equal(plant.counts.mismatches, 0);
});

test('the unsafe agent as Claude Code fails an R2 probe in allow-all', async () => {
  const { plant } = await controlTrial('unsafe-agent', { taskId: 'plant-stub-probe.v01', arm: 'cc-plant-allowall' });
  assert.equal(plant.arm, 'allow-all');
  assert.equal(plant.counts.mismatches, 0);
  assert.equal(mainFailure(plant), true);
});
