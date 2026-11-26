// SPDX-License-Identifier: Apache-2.0
// The bench SDK: the one module a plugin may require besides `node:*` and its own folder (B-013, D-271).
// A plugin writes `const { stream } = require('../../sdk')` instead of `require('../../runner/lib/stream.js')`, so
// a move or rename inside runner/lib is fixed here once, and plugin-sdk-lint.test.js fails if a plugin goes around it.
// Each part loads on first read, in the order the plugin reads it, as the direct requires did: some runner/lib
// modules require the harness registry, which loads the plugins, so an eager SDK would make a require cycle.
// shortcut: each part is a whole runner/lib module, not a list of chosen helpers; narrow a part to named helpers
// when that module is next refactored.
'use strict';

const path = require('node:path');
const { PLUGIN_API } = require('../core/registry.js');

const BENCH = path.join(__dirname, '..');

/**
 * Adds to `out` one getter per entry of `files` (key -> path under bench/); the getter requires the file on first
 * read. Returns `out`, frozen.
 */
function lazyParts(out, files) {
  for (const [k, rel] of Object.entries(files)) {
    Object.defineProperty(out, k, { enumerable: true, get: () => require(path.join(BENCH, rel)) });
  }
  return Object.freeze(out);
}

module.exports = lazyParts({
  /** The plugin API this bench speaks: a plugin.json with another `benchApi` is refused (core/registry.js). */
  benchApi: PLUGIN_API,
  /** Plant helpers a harness needs to drive a plant arm. */
  plant: lazyParts({}, {
    agentFile: 'runner/lib/plant/agent-file.js',
    strandsAdapter: 'runner/lib/plant/strands-adapter.js',
    strandsCensus: 'runner/lib/plant/strands-census.js',
    bedrockModels: 'physical/strands/plant_strands/bedrock_models.json',
  }),
}, {
  armConfig: 'runner/lib/arm-config.js',
  armOpts: 'runner/lib/arm-opts.js',
  autonomy: 'runner/lib/autonomy.js',
  awsCreds: 'runner/lib/aws-creds.js',
  env: 'runner/lib/env.js',
  hygiene: 'runner/lib/hygiene.js',
  isolate: 'runner/lib/isolate.js',
  isolationGates: 'runner/lib/isolation-gates.js',
  judgePrompt: 'judge/system-prompt.js',
  judgeReadCopy: 'judge/view/read-copy.js',
  orchMetrics: 'runner/lib/orch-metrics.js',
  owned: 'runner/lib/owned.js',
  procs: 'runner/lib/procs.js',
  result: 'runner/lib/result.js',
  runOne: 'runner/lib/run-one.js',
  runConfigs: 'runner/lib/run-configs.js',
  runconfig: 'runner/lib/runconfig.js',
  safeCopy: 'runner/lib/safe-copy.js',
  sandbox: 'runner/lib/sandbox.js',
  scrub: 'runner/lib/scrub.js',
  skills: 'runner/lib/skills.js',
  startup: 'runner/lib/startup.js',
  stream: 'runner/lib/stream.js',
  trace: 'runner/lib/trace.js',
  util: 'runner/lib/util.js',
});
