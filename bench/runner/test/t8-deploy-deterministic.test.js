// SPDX-License-Identifier: Apache-2.0
'use strict';

// FW-35 (DEBT D-229): t8-dec-deploy-strategy flipped 50/100 between replicates on the forced-skills pilot. Its grader
// is a fixed block key, so the same answer must score the same every time; the spread comes from the agents' answers.
// This runs the free dry run three times per answer (reference, stub, lazy, alt) and checks every repeat agrees.

const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { dryRun } = require('../../scenarios/lib/dry-run.js');
const { loadConfig } = require('../../scenarios/lib/config.js');

test('t8-dec-deploy-strategy scores the same on three runs of each answer of its fixture', () => {
  const cfg = loadConfig(path.join(__dirname, '../../scenarios/t8/scenario.config.js'));
  const res = dryRun('t8-dec-deploy-strategy', cfg, { repeat: 3 });
  assert.equal(res.deterministic, true);
  assert.equal(res.scores.reference, 100);
  assert.equal(res.pass, true);
});
