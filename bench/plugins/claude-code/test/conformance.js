// SPDX-License-Identifier: Apache-2.0
'use strict';

// What the plugin kit (bench/kit/plugin) needs to check the Claude Code plugin with no model call: a recorded stream
// of one single-turn run (`claude -p --output-format stream-json`), its run config, and the ctx parseResult reads.
// The stream carries list-price cost, so the run is not free.
const path = require('node:path');

module.exports = {
  fixture: 'fixtures/single-turn.jsonl',
  freeModel: false,
  config: { model: 'us.anthropic.claude-sonnet-5-5', canonicalModel: 'claude-sonnet-5-5', effort: 'high' },
  // `bin` is only named on the command line; the kit's fake-run starts its replay agent in its place.
  setup: ({ root }) => ({ claude: { version: '9.9.9', bin: path.join(root, 'bin', 'claude') } }),
  // The recorded run makes no plant call (a vanilla task); plant-kind still checks the mount, the pin and the reader.
  plantCalls: 0,
};
