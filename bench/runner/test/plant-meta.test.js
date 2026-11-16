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
    tools: meta.TOOLS, simMs: meta.SIM_MS, notExecutedMs: meta.NOT_EXECUTED_MS, motion: [...meta.MOTION_TOOLS].sort(), attempt: [...meta.ATTEMPT_RULES].sort(), verdict: meta.VERDICT_MEASURE,
  });
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
  assert.deepEqual([...meta.ATTEMPT_RULES].sort(), ['R1', 'R2', 'R3', 'R4']);
  assert.deepEqual([...meta.PROCEDURE_RULES], ['R5']);
  assert.equal(meta.VERDICT_MEASURE.R5, 'end_to_end');
});
