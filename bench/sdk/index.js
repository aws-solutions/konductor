// SPDX-License-Identifier: Apache-2.0
// The bench SDK: the one module a plugin may require besides `node:*` and its own folder (B-013, D-271).
// A plugin writes `const { stream } = require('../../sdk')` instead of `require('../../runner/lib/stream.js')`, so
// a move or rename inside runner/lib is fixed here once, and plugin-sdk-lint.test.js fails if a plugin goes around it.
// Each part is a frozen list of the helpers named here (D-285), not the whole module behind it, so a helper nobody
// listed can be renamed or dropped with no plugin hurt, and the lint fails on a plugin that reads an unlisted one.
// A helper loads on first read, as the direct requires did: some runner/lib modules require the harness registry,
// which loads the plugins, so an eager SDK would make a require cycle.
'use strict';

const path = require('node:path');
const { PLUGIN_API } = require('../core/registry.js');

const BENCH = path.join(__dirname, '..');

/**
 * A frozen part: one getter per name in `names`, each reading that export of the file `rel` (under bench/) when read.
 * Adding a helper to a plugin means adding its name here.
 * @param {string} rel  the module's path under bench/
 * @param {string[]} names  the exports a plugin may read
 */
function part(rel, names) {
  const out = {};
  for (const n of names) Object.defineProperty(out, n, { enumerable: true, get: () => require(path.join(BENCH, rel))[n] });
  return Object.freeze(out);
}

module.exports = Object.freeze({
  /** The plugin API this bench speaks: a plugin.json with another `benchApi` is refused (core/registry.js). */
  benchApi: PLUGIN_API,
  /** Plant helpers a harness needs to drive a plant arm. */
  plant: Object.freeze({
    agentFile: part('runner/lib/plant/agent-file.js', ['MCP_CONFIG_REL', 'SERVER_NAME', 'plantPrompt']),
    strandsAdapter: part('runner/lib/plant/strands-adapter.js', ['launcherForCwd', 'pythonArgs']),
    strandsCensus: part('runner/lib/plant/strands-census.js', ['preflightStrands']),
    bedrockModels: part('physical/strands/plant_strands/bedrock_models.json', ['models', 'pricesSource', 'region']),
  }),
  armConfig: part('runner/lib/arm-config.js', ['writeArmConfig']),
  armOpts: part('runner/lib/arm-opts.js', ['promptFor']),
  autonomy: part('runner/lib/autonomy.js', ['turnStreamTexts']),
  awsCreds: part('runner/lib/aws-creds.js', ['awsExport', 'isProfileName', 'makeExportedCredentials', 'profileCredentials', 'writeCredentials']),
  env: part('runner/lib/env.js', ['ALLOW', 'buildChildEnv']),
  hygiene: part('runner/lib/hygiene.js', ['redactHostPaths', 'scrubTreeDetailed']),
  isolate: part('runner/lib/isolate.js', ['makeIsolation', 'realHomes', 'resolveIsolation']),
  isolationGates: part('runner/lib/isolation-gates.js', ['ensureEmptyClaudeRules']),
  judgePrompt: part('judge/system-prompt.js', ['JUDGE_SYSTEM_PROMPT', 'systemPromptSha256']),
  judgeReadCopy: part('judge/view/read-copy.js', ['instructionFilesAbove', 'writeCopy']),
  orchMetrics: part('runner/lib/orch-metrics.js', ['orchMetrics', 'orchMetricsOfRunDir']),
  owned: part('runner/lib/owned.js', ['writeAtomic']),
  procs: part('runner/lib/procs.js', ['trackScratch', 'untrackScratch']),
  result: part('runner/lib/result.js', ['crossCheckCredits']),
  runOne: part('runner/lib/run-one.js', ['spawnWithTimeout']),
  runConfigs: part('runner/lib/run-configs.js', ['readRunConfigs']),
  runconfig: part('runner/lib/runconfig.js', ['availableEngines', 'envPolicy']),
  safeCopy: part('runner/lib/safe-copy.js', ['assertPlainPath', 'copyPlainFile']),
  sandbox: part('runner/lib/sandbox.js', [
    'KIRO_REQUIRED', 'buildCli', 'buildDirOf', 'copyAuthDb', 'emptyKiroHome', 'exportArm', 'installInto', 'kiroCliVersion',
    'normalizeAgentModels', 'prepareArm', 'readyMatches', 'removeAuthCopy', 'run', 'runKonductor', 'sha256File', 'synthArm', 'versionOf',
  ]),
  scrub: part('runner/lib/scrub.js', ['secretLiterals']),
  skills: part('runner/lib/skills.js', ['captureSkills', 'claudeSkillInfo', 'has', 'kiroCalls', 'kiroFirstDecision', 'kiroSkillInfo', 'opencodeSkillInfo']),
  startup: part('runner/lib/startup.js', ['installedSkills']),
  stream: part('runner/lib/stream.js', [
    'SUBAGENT_TOOL', 'aggregateStream', 'detectAskedUser', 'isV3Call', 'mcpInputOf', 'mergeAggregates', 'parseStream', 'runErrorOf',
    'sessionModels', 'skillActivationOf', 'skillFileReadOf', 'skillResourceCallOf', 'skillsCallOf', 'subagentTargets',
    'summarizeSessionJson', 'toolNameOf',
  ]),
  trace: part('runner/lib/trace.js', ['claudeTimeline', 'kiroTimeline']),
  util: part('runner/lib/util.js', ['readTextOrNull']),
});
