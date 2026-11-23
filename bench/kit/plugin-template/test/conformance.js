// SPDX-License-Identifier: Apache-2.0
'use strict';

// What the plugin kit needs to check this plugin with no model call: a recorded stream of one single-turn run, the
// run config it came from, and the ctx parseResult reads (none here). The template agent costs nothing.
// Record a new stream: node agent.js --model fake 'hello' > fixtures/single-turn.jsonl, then
// node bench/kit/plugin/check.js --record <this plugin dir> to write test/golden.json.
module.exports = {
  fixture: 'fixtures/single-turn.jsonl',
  freeModel: true,
  config: { model: 'fake', effort: 'default' },
  setup: () => ({}),
};
