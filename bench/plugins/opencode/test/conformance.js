// SPDX-License-Identifier: Apache-2.0
'use strict';

// What the plugin kit (bench/kit/plugin) needs to check the opencode plugin with no model call: a recorded stream of
// one single-turn run, its run config, and the ctx parseResult reads. parseResult reads token usage from opencode's
// own database through `opencode db`, so `setup` puts a fake opencode binary on the ctx that answers with the recorded
// rows (fixtures/rows.json). The rows carry list-price cost, so the run is not free.
const fs = require('node:fs');
const path = require('node:path');
const { makeFakeOpencode } = require('../../../runner/test/fake-opencode.js');

module.exports = {
  fixture: 'fixtures/single-turn.jsonl',
  freeModel: false,
  config: { model: 'global.anthropic.claude-sonnet-5-5', effort: 'low' },
  setup({ root }) {
    const bin = makeFakeOpencode(path.join(root, 'bin'), { rowsFile: path.join(__dirname, 'fixtures', 'rows.json') });
    // The fake-run check installs into a scratch HOME, which copies one profile of this stub credentials file.
    const awsCredsFile = path.join(root, 'aws-credentials');
    fs.writeFileSync(awsCredsFile, '[bench]\naws_access_key_id = STUBKEYID\naws_secret_access_key = stub-secret\n');
    return { opencode: { bin, version: '1.19.5', sha256: 'x' }, awsProfile: 'bench', awsCredsFile };
  },
};
