// SPDX-License-Identifier: Apache-2.0
/**
 * Unit tests for scripts/run-claude-subset.js's pure/IO-light helpers
 * (argument parsing, registry lookup, scenario filtering). The full
 * `runSubset()` flow spawns the real `claude` CLI and is exercised by the
 * end-to-end smoke test documented in docs/guides/benchmarking.md instead.
 *
 * Run: node --test tests/scripts/run-claude-subset.test.js
 */
'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const runSubsetModule = require('../../scripts/run-claude-subset.js');

test('parseArgs collects positional args separately from flags', () => {
  const opts = runSubsetModule.parseArgs(['k-developer', '--replicates', '3', '--output', 'out']);
  assert.deepEqual(opts._, ['k-developer']);
  assert.equal(opts.replicates, '3');
  assert.equal(opts.output, 'out');
});

test('loadRegistryEntry finds a known public subset with its requiredMcpServer', () => {
  const entry = runSubsetModule.loadRegistryEntry('k-developer');
  assert.ok(entry, 'expected a k-developer registry entry');
  assert.equal(entry.requiredMcpServer, 'aws-mcp');
});

test('loadRegistryEntry returns null for an unregistered subset', () => {
  assert.equal(runSubsetModule.loadRegistryEntry('asdlc-does-not-exist'), null);
});

// The regression this pins: the agent identifier and the scenario directory
// used to be derived from the same `--agent` string, so once the Konductor
// rename moved registry `name` to `k-*` while the directories stayed
// `asdlc-*`, no value of `--agent` satisfied both. Each subset's registry
// `name` must now resolve to a directory that exists on disk.
test('every registry subset resolves to a scenario directory that exists', () => {
  const registryPath = path.join(__dirname, '..', 'registry.json');
  const registry = JSON.parse(fs.readFileSync(registryPath, 'utf-8'));
  assert.ok(registry.subsets.length > 0, 'expected a non-empty registry');
  for (const subset of registry.subsets) {
    const entry = runSubsetModule.loadRegistryEntry(subset.name);
    assert.ok(entry, `expected a registry entry for '${subset.name}'`);
    const dir = runSubsetModule.resolveDatasetDir(subset.name, entry);
    assert.ok(fs.existsSync(dir), `subset '${subset.name}' resolved to a missing dataset dir: ${dir}`);
  }
});

test('resolveDatasetDir falls back to the subset name when the entry declares no datasetPath', () => {
  const dir = runSubsetModule.resolveDatasetDir('judges', null);
  assert.equal(dir, path.join(__dirname, '..', 'judges'));
  assert.equal(runSubsetModule.resolveDatasetDir('judges', {}), dir);
});

test('resolveDatasetDir rejects a datasetPath that escapes tests/', () => {
  assert.throws(() => runSubsetModule.resolveDatasetDir('x', { datasetPath: '../scripts' }), /escapes tests\//);
  assert.throws(() => runSubsetModule.resolveDatasetDir('x', { datasetPath: '/etc' }), /escapes tests\//);
});

test('filterScenarios is a no-op when no substrings are given', () => {
  const scenarios = [{ taskId: 'a-1' }, { taskId: 'b-2' }];
  assert.deepEqual(runSubsetModule.filterScenarios(scenarios, undefined), scenarios);
  assert.deepEqual(runSubsetModule.filterScenarios(scenarios, []), scenarios);
});

test('filterScenarios matches taskId substrings case-insensitively', () => {
  const scenarios = [
    { taskId: 'developer-backend-review - Level 1' },
    { taskId: 'developer-git-workflow - Level 3' },
  ];
  const filtered = runSubsetModule.filterScenarios(scenarios, ['GIT-WORKFLOW']);
  assert.deepEqual(filtered, [{ taskId: 'developer-git-workflow - Level 3' }]);
});

test('filterScenarios can match on the id field when taskId is absent', () => {
  const scenarios = [{ id: 'foo-bar' }, { id: 'baz-qux' }];
  assert.deepEqual(runSubsetModule.filterScenarios(scenarios, ['baz']), [{ id: 'baz-qux' }]);
});
