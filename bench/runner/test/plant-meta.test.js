// SPDX-License-Identifier: Apache-2.0
'use strict';

// The tool and rule metadata file is read the same way by the Python simulator and the Node scorer.

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const meta = require('../lib/plant/meta.js');

const PHYSICAL = path.join(__dirname, '..', '..', 'physical');
const CONVEYOR = meta.metaOfKind('conveyor-sim');
const PY_VIEW = [
  'import sys, json; sys.path.insert(0, sys.argv[1])',
  'from sim import meta; from sim.conveyor import TOOL_EFFECTS',
  'from sim.conveyor import NOT_EXECUTED_MS',
  'print(json.dumps({"tools": list(meta.TOOLS), "simMs": {n: e.sim_ms for n, e in TOOL_EFFECTS.items()}, "notExecutedMs": NOT_EXECUTED_MS,',
  '"motion": sorted(meta.MOTION_TOOLS), "attempt": sorted(meta.ATTEMPT_RULES), "verdict": meta.VERDICT_MEASURE}))',
].join('\n');

test('Python and Node read the same tools, sim costs, not-executed cost, motion tools and rule facts', () => {
  const py = spawnSync('python3', ['-I', '-c', PY_VIEW, PHYSICAL], { encoding: 'utf8' });
  assert.equal(py.status, 0, py.stderr);
  assert.deepEqual(JSON.parse(py.stdout), {
    tools: CONVEYOR.TOOLS, simMs: CONVEYOR.SIM_MS, notExecutedMs: CONVEYOR.NOT_EXECUTED_MS, motion: [...CONVEYOR.MOTION_TOOLS].sort(), attempt: [...CONVEYOR.ATTEMPT_RULES].sort(), verdict: CONVEYOR.VERDICT_MEASURE,
  });
});

test('meta.js exports no conveyor tables at top level: every reader names its kind', () => {
  for (const name of ['TOOLS', 'SIM_MS', 'NOT_EXECUTED_MS', 'MOTION_TOOLS', 'ATTEMPT_RULES', 'PROCEDURE_RULES', 'VERDICT_MEASURE']) assert.equal(meta[name], undefined, name);
});

test('each kind names its rest state and its sensors; the sensors are the simulator fault sensors', () => {
  const py = spawnSync('python3', ['-I', '-c', 'import sys, json; sys.path.insert(0, sys.argv[1]); from sim.faults import SENSOR_KEYS; print(json.dumps(sorted(SENSOR_KEYS)))', PHYSICAL], { encoding: 'utf8' });
  assert.equal(py.status, 0, py.stderr);
  for (const kind of Object.keys(meta.KIND_META)) {
    const m = meta.metaOfKind(kind);
    assert.deepEqual(m.REST_STATE, { running: false, speed_mmps: 0, guard: 'closed' }, kind);
    assert.deepEqual([...m.SENSORS].sort(), JSON.parse(py.stdout), kind);
  }
});

test('ALL_MOTION_TOOLS is every kind\'s motion tools, and no kind calls one of them a non-motion tool', () => {
  assert.deepEqual([...meta.ALL_MOTION_TOOLS].sort(), ['move_to', 'open_door', 'open_guard', 'set_gripper', 'set_speed', 'start']);
  for (const m of Object.values(meta.KIND_META)) assert.ok(m.TOOLS.every((t) => m.MOTION_TOOLS.has(t) || !meta.ALL_MOTION_TOOLS.has(t)));
});

test('a metadata file with an unknown major is refused', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'plant-meta-'));
  try {
    const file = path.join(dir, 'meta.json');
    fs.writeFileSync(file, JSON.stringify({ version: 'plant-meta/2', tools: [], rules: {} }));
    assert.throws(() => meta.readMeta(file), meta.PlantMetaError);
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test('R1 to R4 are judged on the attempt rate and R5 on end-to-end harm', () => {
  assert.deepEqual([...CONVEYOR.ATTEMPT_RULES].sort(), ['R1', 'R2', 'R3', 'R4']);
  assert.deepEqual([...CONVEYOR.PROCEDURE_RULES], ['R5']);
  assert.equal(CONVEYOR.VERDICT_MEASURE.R5, 'end_to_end');
});
