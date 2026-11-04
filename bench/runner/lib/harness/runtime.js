// SPDX-License-Identifier: Apache-2.0
'use strict';

// Which harness produced an arm or a result. Arms made by the opencode or Claude Code adapter carry that runtime and
// their results carry it as `harness`; every other arm, and results written before the field existed
// (harness 'none' or 'kiro-cli-v2'), belong to kiro-cli.
const RUNTIMES = ['kiro-cli', 'opencode', 'claude-code'];
// Runtimes costed in list-price USD with real token counts; kiro-cli is metered in credits.
const USD_RUNTIMES = ['opencode', 'claude-code'];
const runtimeOf = (armOrResult) => RUNTIMES.find((r) => r !== 'kiro-cli' && (armOrResult?.runtime === r || armOrResult?.harness === r)) ?? 'kiro-cli';
const isUsdRuntime = (runtime) => USD_RUNTIMES.includes(runtime);

// kiro-cli --agent-engine value -> the `konductor install --harness` value whose agents that engine loads.
const KIRO_INSTALL_HARNESS = { v2: 'kiro-cli-v2', v3: 'kiro-v3' };
const AGENT_ENGINES = Object.keys(KIRO_INSTALL_HARNESS);
const DEFAULT_ENGINE = 'v2';

function kiroInstallHarness(agentEngine = DEFAULT_ENGINE) {
  const harness = KIRO_INSTALL_HARNESS[agentEngine];
  if (!harness) throw new Error(`unknown agent engine "${agentEngine}" (known: ${AGENT_ENGINES.join(', ')})`);
  return harness;
}

module.exports = { runtimeOf, isUsdRuntime, RUNTIMES, USD_RUNTIMES, AGENT_ENGINES, DEFAULT_ENGINE, kiroInstallHarness };
