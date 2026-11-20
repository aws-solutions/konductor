// SPDX-License-Identifier: Apache-2.0
'use strict';

// T3's batch config for the shared scenario tools (bench/scenarios/lib/config.js lists the fields).
//   node bench/scenarios/lib/dry-run.js --config bench/scenarios/t3/scenario.config.js [id ...] [--json]
// T3's dry-run score is the hidden-test share alone, rounded to a whole number, as its recorded pilot.dryRun has it
// (AUTHORING-LOG.md). The hidden dirs name decision-lib.js, and the gated tasks gate.js, from bench/scenarios/lib/hidden
// in .bench-lib.json; a gated task's tests command preloads it with `node --require ./hidden/gate.js`.

const { codeScore } = require('../lib/score.js');

module.exports = {
  dir: __dirname,
  python: false,
  score: (results) => {
    const c = codeScore(results);
    return { ...c, score: c.hidden === null ? null : Math.round(c.hidden * 100) };
  },
};
