// SPDX-License-Identifier: Apache-2.0
'use strict';

// T8's batch config for the shared scenario tools (bench/scenarios/lib/config.js lists the fields).
// Hidden dirs are laid over the workspace root as they are (hidden/<id>/block.test.js, block-kit/), so no canary:
// each tests check names its one test file.

module.exports = {
  dir: __dirname,
};
