// SPDX-License-Identifier: Apache-2.0
/**
 * Unit tests for tests/judges/claude-code-agent-runner.js's pure helper
 * functions (no `claude` CLI invocation — those are exercised by the
 * end-to-end smoke test documented in docs/guides/benchmarking.md).
 *
 * Run: node --test tests/scripts/claude-code-agent-runner.test.js
 */
'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const fs = require('node:fs');
const path = require('node:path');

const runner = require('../judges/claude-code-agent-runner.js');
const { CONSTANTS } = require('../../scripts/brand-config/lib/constants.js');

const REPO_ROOT = path.join(__dirname, '..', '..');
const registry = JSON.parse(fs.readFileSync(path.join(REPO_ROOT, 'tests', 'registry.json'), 'utf-8'));

/** True if `name` is an agent this package actually ships a spec for. */
function agentSpecExists(name) {
  return fs.existsSync(path.join(REPO_ROOT, 'agents', `${name}.agent-spec.json`));
}

// The regression this pins: evaluate() used to strip a hardcoded `asdlc-`
// prefix and rebuild `asdlc-<role>`, which after the Konductor rename
// dispatched `--agent` at an agent that exists in neither the pre- nor the
// post-rename naming scheme. Asserting against the agents/ directory rather
// than a literal expected string keeps this test honest through a future
// rename: it fails whenever resolution names an agent that isn't shipped.
test('resolveAgentName resolves every registry subset to an agent spec that exists', () => {
  assert.ok(registry.subsets.length > 0, 'expected a non-empty registry');
  for (const subset of registry.subsets) {
    const resolved = runner.resolveAgentName({ subsetName: subset.name });
    assert.ok(
      agentSpecExists(resolved),
      `subset '${subset.name}' resolved to '${resolved}', which has no agents/${resolved}.agent-spec.json`,
    );
  }
});

test('resolveAgentName leaves an already-current agent name unchanged', () => {
  const name = `${CONSTANTS.agent_prefix}developer`;
  assert.equal(runner.resolveAgentName({ subsetName: name }), name);
});

test('resolveAgentName migrates a retired prefix onto the current one', () => {
  for (const retired of CONSTANTS.retired_agent_prefixes || []) {
    assert.equal(
      runner.resolveAgentName({ subsetName: `${retired}-developer` }),
      `${CONSTANTS.agent_prefix}developer`,
    );
  }
});

// The retired-prefix migration assumed a uniform prefix swap, which is wrong
// for the orchestrator: `${retired}-orchestrator` used to resolve to
// `${agent_prefix}orchestrator` (e.g. "k-orchestrator"), an agent spec that
// does not exist. The real migrated name comes from
// CONSTANTS.orchestrator_agent / orchestrator_variants, not a prefix swap.
test('resolveAgentName migrates a retired orchestrator prefix onto orchestrator_agent, not a prefix swap', () => {
  for (const retired of CONSTANTS.retired_agent_prefixes || []) {
    const resolved = runner.resolveAgentName({ subsetName: `${retired}-orchestrator` });
    assert.equal(resolved, CONSTANTS.orchestrator_agent);
    assert.ok(agentSpecExists(resolved), `expected agents/${resolved}.agent-spec.json to exist`);
  }
});

// Same migration gap for the mux/cmux orchestrator variants: the retired
// prefix swap produced e.g. "k-mux-orchestrator", which is not a real agent
// spec either. Exercises every retired prefix against every declared
// orchestrator variant, keyed off the variant's own name (not hardcoded), so
// the test stays honest through a future rename.
test('resolveAgentName migrates a retired orchestrator-variant prefix onto its real orchestrator_variants entry', () => {
  for (const retired of CONSTANTS.retired_agent_prefixes || []) {
    for (const variant of CONSTANTS.orchestrator_variants || []) {
      // variant is like "konductor-mux-orchestrator" -- derive the role
      // suffix ("mux-orchestrator") the retired name would carry.
      const suffix = variant.slice(variant.indexOf('-') + 1);
      const resolved = runner.resolveAgentName({ subsetName: `${retired}-${suffix}` });
      assert.equal(resolved, variant);
      assert.ok(agentSpecExists(resolved), `expected agents/${resolved}.agent-spec.json to exist`);
    }
  }
});

test('resolveAgentName passes the bare orchestrator and its variants through untouched', () => {
  // These carry no agent_prefix at all, so a prefix-only rule would mangle them.
  for (const name of [CONSTANTS.orchestrator_agent, ...CONSTANTS.orchestrator_variants]) {
    assert.equal(runner.resolveAgentName({ subsetName: name }), name);
    assert.ok(agentSpecExists(name), `expected agents/${name}.agent-spec.json to exist`);
  }
});

test('resolveAgentName falls back to datasetPath, then to the taskId role', () => {
  const expected = `${CONSTANTS.agent_prefix}developer`;
  assert.equal(runner.resolveAgentName({ datasetPath: './asdlc-developer' }), expected);
  assert.equal(runner.resolveAgentName({ datasetPath: `${CONSTANTS.agent_prefix}developer/` }), expected);
  assert.equal(runner.resolveAgentName({ taskId: 'developer-git-workflow - Level 3' }), expected);
});

test('resolveAgentName prefers subsetName over the weaker fallbacks', () => {
  const resolved = runner.resolveAgentName({
    subsetName: `${CONSTANTS.agent_prefix}quality-assurance`,
    datasetPath: './asdlc-developer',
    taskId: 'developer-x',
  });
  assert.equal(resolved, `${CONSTANTS.agent_prefix}quality-assurance`);
});

test('resolveAgentName throws when given no identifying field at all', () => {
  assert.throws(() => runner.resolveAgentName({}), /need one of/);
  assert.throws(() => runner.resolveAgentName(), /need one of/);
});

test('matchesExpectedString matches a whole word, case-insensitively', () => {
  assert.equal(runner.matchesExpectedString('This is CRITICAL.', 'critical'), true);
  assert.equal(runner.matchesExpectedString('this is Critical', 'CRITICAL'), true);
});

test('matchesExpectedString does not match a substring inside a longer word', () => {
  assert.equal(runner.matchesExpectedString('this code is supercritical', 'critical'), false);
});

test('matchesExpectedString discards a match immediately preceded by a negation', () => {
  assert.equal(runner.matchesExpectedString('this is not critical', 'critical'), false);
  assert.equal(runner.matchesExpectedString("this isn't critical either", 'critical'), false);
});

test('matchesExpectedString still matches when the negation applies to a different clause', () => {
  assert.equal(runner.matchesExpectedString('not sure, but this is critical', 'critical'), true);
});

test('resolveMcpWarmupMs falls back to the default when unset', () => {
  assert.equal(runner.resolveMcpWarmupMs({}), runner.MCP_WARMUP_MS_DEFAULT);
});

test('resolveMcpWarmupMs clamps to MCP_WARMUP_MS_MAX', () => {
  assert.equal(runner.resolveMcpWarmupMs({ mcpWarmupMs: 999999 }), runner.MCP_WARMUP_MS_MAX);
});

test('resolveMcpWarmupMs honors an explicit context value within bounds', () => {
  assert.equal(runner.resolveMcpWarmupMs({ mcpWarmupMs: 1234 }), 1234);
});

test('extractMcpReady returns null (skip) when no requiredServerName is given', () => {
  // Most agents declare no MCP servers, so the gate defaults to
  // "not applicable" rather than hard-coding a specific server's name.
  const streamLines = [JSON.stringify({ type: 'system', subtype: 'init', mcp_servers: [{ name: 'aws-mcp', status: 'connected' }] })];
  assert.equal(runner.extractMcpReady(streamLines, null), null);
  assert.equal(runner.extractMcpReady(streamLines, undefined), null);
});

test('extractMcpReady returns true/false when a requiredServerName is given and found', () => {
  const streamLines = [
    JSON.stringify({ type: 'system', subtype: 'init', mcp_servers: [{ name: 'aws-mcp', status: 'connected' }] }),
  ];
  assert.equal(runner.extractMcpReady(streamLines, 'aws-mcp'), true);
  assert.equal(runner.extractMcpReady(streamLines, 'some-other-mcp'), false);
});

test('extractMcpReady returns null when no init event is present at all', () => {
  assert.equal(runner.extractMcpReady(['not json', '{}'], 'aws-mcp'), null);
});

test('extractModelId reads the model off either a top-level or nested message field', () => {
  assert.equal(runner.extractModelId([JSON.stringify({ model: 'claude-sonnet-5' })]), 'claude-sonnet-5');
  assert.equal(runner.extractModelId([JSON.stringify({ message: { model: 'claude-opus-4.6' } })]), 'claude-opus-4.6');
  assert.equal(runner.extractModelId(['garbage']), null);
});
