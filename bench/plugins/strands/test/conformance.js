// SPDX-License-Identifier: Apache-2.0
'use strict';

// What the harness plugin kit (bench/kit/plugin) needs to check this plugin with no model call: a recorded stream of
// one single-turn run, the run config it came from, and the ctx parseResult reads. Only the scripted fake model is
// used, so the run cost nothing.
module.exports = {
  fixture: 'fixtures/single-turn.jsonl',
  freeModel: true,
  config: { model: 'fake:/fixture/script.json', effort: 'default' },
  setup: () => ({ strands: { python: 'python3', prefix: '/venv', basePrefix: '/python', version: '1.65.0', agentFile: null } }),
};
