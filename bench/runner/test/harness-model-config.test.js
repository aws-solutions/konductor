// SPDX-License-Identifier: Apache-2.0
// FW-18 step 6 (DEBT D-212): each harness turns --model and --effort into its run's model config (`modelConfig`), so
// run-cmd.js no longer branches on the runtime name. The values below are what run-cmd.js wrote before the move. No
// model call.
'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { HARNESSES } = require('../lib/harness/index.js');

const DEFAULTS = { defaultEffort: 'high' };

test('every harness has modelConfig', () => {
  for (const [id, h] of Object.entries(HARNESSES)) assert.equal(typeof h.modelConfig, 'function', id);
});

test('kiro-cli: default model and effort, the agent engine passed through', () => {
  assert.deepEqual(HARNESSES['kiro-cli'].modelConfig({ opts: {}, agentEngine: 'v2', ...DEFAULTS }), { model: 'claude-sonnet-5.5', effort: 'high', agentEngine: 'v2' });
  assert.deepEqual(HARNESSES['kiro-cli'].modelConfig({ opts: { model: 'm', effort: 'low' }, agentEngine: 'v3', ...DEFAULTS }), { model: 'm', effort: 'low', agentEngine: 'v3' });
});

test('opencode: its default model and the variant of the effort', () => {
  const oc = HARNESSES.opencode;
  assert.deepEqual(oc.modelConfig({ opts: {}, ...DEFAULTS }), { model: oc.DEFAULT_MODEL, effort: oc.variantOf('high') });
  assert.deepEqual(oc.modelConfig({ opts: { model: 'x', effort: 'low' }, ...DEFAULTS }), { model: 'x', effort: oc.variantOf('low') });
});

test('claude-code: its default model, the canonical model and its effort word', () => {
  const cc = HARNESSES['claude-code'];
  assert.deepEqual(cc.modelConfig({ opts: {}, ...DEFAULTS }), { model: cc.DEFAULT_MODEL, canonicalModel: cc.canonicalModel(cc.DEFAULT_MODEL), effort: cc.effortOf('high') });
  assert.throws(() => cc.modelConfig({ opts: { effort: 'nonsense' }, ...DEFAULTS }));
});

test('strands: the model as given, effort default', () => {
  assert.deepEqual(HARNESSES.strands.modelConfig({ opts: { model: 'fake:/x.json', effort: 'low' }, ...DEFAULTS }), { model: 'fake:/x.json', effort: 'default' });
});
