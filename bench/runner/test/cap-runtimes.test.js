// SPDX-License-Identifier: Apache-2.0
'use strict';

// cap/runtimes.js: what the cap commands know about each runtime, read from the harness descriptors.

const test = require('node:test');
const assert = require('node:assert/strict');
const rt = require('../../cap/runtimes.js');
const { DESCRIPTORS } = require('../lib/harness/descriptors.js');

test('the cap runtimes are the descriptors with capabilities; one reads acting agents, one drives the skill study', () => {
  assert.deepEqual(rt.CAP_RUNTIME_IDS, DESCRIPTORS.filter((d) => d.supports.capCommands).map((d) => d.id));
  assert.equal(rt.ACTING_RUNTIME, DESCRIPTORS.find((d) => d.capabilities?.actingAgents).id);
  assert.equal(rt.STUDY_RUNTIME, DESCRIPTORS.find((d) => d.supports.skillStudy).id);
  for (const d of rt.CAP_RUNTIMES) assert.equal(rt.runtimeOfSurface(d.capabilities.surface), d.id);
});

test('--harness: the default runtime, a cap runtime, "both" only where allowed, anything else refused by name', () => {
  assert.equal(rt.capHarness(undefined), DESCRIPTORS.find((d) => d.armPrefix === '').id);
  assert.equal(rt.capHarness(undefined, { both: true }), 'both');
  for (const id of rt.CAP_RUNTIME_IDS) assert.equal(rt.capHarness(id), id);
  assert.throws(() => rt.capHarness('both'), new RegExp(`--harness takes ${rt.CAP_RUNTIME_IDS.join(' or ')}$`));
  assert.throws(() => rt.capHarness('nonesuch', { both: true }), /or both$/);
});

test('the budget flag follows the cost unit', () => {
  for (const d of rt.CAP_RUNTIMES) assert.equal(rt.budgetFlagOf(d.id), d.costUnit === 'usd' ? 'budget-usd' : 'budget-credits');
});
