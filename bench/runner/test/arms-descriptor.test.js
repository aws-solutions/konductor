// SPDX-License-Identifier: Apache-2.0
// FW-18 step 6 (DEBT D-212): arms.js reads which runtime is plant-only, which may run hooked plant arms and which is the
// default from the harness descriptors (`plant.only`, `plant.hooked`, the empty arm prefix), not from runtime names.
// Today that is Strands for both plant flags and Kiro CLI for the default. No model call.
'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { DESCRIPTORS } = require('../lib/harness/descriptors.js');
const { resolveArm, parseArmSpec, STRANDS_PREFIX, PLANT_ARM_IDS } = require('../lib/arms.js');

test('exactly one runtime is plant-only and runs hooked plant arms, and it is Strands', () => {
  assert.deepEqual(DESCRIPTORS.filter((d) => d.plant?.only).map((d) => d.id), ['strands']);
  assert.deepEqual(DESCRIPTORS.filter((d) => d.plant?.hooked).map((d) => d.id), ['strands']);
  assert.equal(STRANDS_PREFIX, 'st-');
});

test('arms resolve to the same runtimes as before', () => {
  assert.equal(resolveArm('vanilla', '/nonexistent').runtime, 'kiro-cli');
  assert.equal(resolveArm('plant-policy', '/nonexistent').runtime, 'kiro-cli');
  assert.equal(resolveArm('st-plant-policy', '/nonexistent').runtime, 'strands');
  assert.equal(resolveArm('st-plant-allowall-hooked', '/nonexistent').plant.hooks, 'own-arm');
  assert.equal(resolveArm('cc-plant-policy', '/nonexistent').runtime, 'claude-code');
  assert.equal(parseArmSpec('st-plant-policy').st, true);
  assert.throws(() => parseArmSpec('cc-plant-policy-hooked'), /hooked plant arms run on Strands only \(st-plant-policy-hooked\)/);
  assert.throws(() => parseArmSpec('st-vanilla'), /Strands arms are plant arms only/);
});

// DEBT D-286: the refusal lists the st- arms from the arm tables, so a new plant arm shows up in it with no text edit.
test('the Strands refusal lists exactly the st- ids in PLANT_ARM_IDS', () => {
  const ids = PLANT_ARM_IDS.filter((id) => id.startsWith(STRANDS_PREFIX));
  assert.deepEqual(ids, ['st-plant-policy', 'st-plant-allowall', 'st-plant-policy-hooked', 'st-plant-allowall-hooked']);
  assert.throws(() => parseArmSpec('st-vanilla'), (e) => e.message === `arm "st-vanilla": Strands arms are plant arms only (${ids.join(', ')})`);
});

