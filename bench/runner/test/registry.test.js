// SPDX-License-Identifier: Apache-2.0
'use strict';

// The runtime registry: one descriptor per harness, and the lists other modules derive from it.

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { registry, HARNESSES, harnessFor } = require('../lib/harness/index.js');
const { DESCRIPTORS } = require('../lib/harness/descriptors.js');
const { RUNTIMES, USD_RUNTIMES, isUsdRuntime, runtimeOf } = require('../lib/harness/runtime.js');
const { parseArmSpec, resolveArm, OC_PREFIX, CC_PREFIX } = require('../lib/arms.js');

const SCHEMA = JSON.parse(fs.readFileSync(path.join(__dirname, '..', '..', 'schema', 'result.schema.json'), 'utf8'));
const SUPPORTS = ['trace', 'stopOn', 'effort', 'runCreditLimit', 'multiTurn', 'capCommands', 'skillStudy'];
const entries = Object.entries(registry);

test('the result schema harness enum equals the registry ids', () => {
  assert.deepEqual([...SCHEMA.properties.harness.enum].sort(), Object.keys(registry).sort());
});

test('the registry is built from HARNESSES and matches the descriptor list', () => {
  assert.deepEqual(Object.keys(registry), Object.keys(HARNESSES));
  assert.deepEqual(Object.values(registry), [...DESCRIPTORS]);
  for (const [id, h] of Object.entries(HARNESSES)) assert.equal(h.meta, registry[id], `${id}.meta must be its registry entry`);
});

test('RUNTIMES, USD_RUNTIMES and isUsdRuntime derive from the descriptors', () => {
  assert.deepEqual(RUNTIMES, Object.keys(registry));
  assert.deepEqual(USD_RUNTIMES, entries.filter(([, d]) => d.costUnit === 'usd').map(([id]) => id));
  for (const [id, d] of entries) assert.equal(isUsdRuntime(id), d.costUnit === 'usd', id);
  assert.equal(isUsdRuntime('nonesuch'), false);
});

test('runtimeOf reads runtime or harness, and falls back to the unprefixed runtime', () => {
  const fallback = entries.find(([, d]) => d.armPrefix === '')[0];
  for (const [id] of entries) {
    assert.equal(runtimeOf({ runtime: id }), id);
    assert.equal(runtimeOf({ harness: id }), id);
  }
  for (const legacy of [undefined, null, {}, { harness: 'none' }, { harness: 'kiro-cli-v2' }, { runtime: 'unknown' }]) assert.equal(runtimeOf(legacy), fallback);
});

test('every descriptor has the required fields and types', () => {
  for (const [id, d] of entries) {
    assert.equal(d.id, id);
    assert.ok(typeof d.label === 'string' && d.label.length > 0, `${id}.label`);
    assert.equal(typeof d.armPrefix, 'string', `${id}.armPrefix`);
    assert.ok(d.armPrefix === '' || /^[a-z]+-$/.test(d.armPrefix), `${id}.armPrefix must be empty or letters and a hyphen`);
    assert.ok(['credits', 'usd'].includes(d.costUnit), `${id}.costUnit`);
    assert.deepEqual(Object.keys(d.supports).sort(), [...SUPPORTS].sort(), `${id}.supports keys`);
    for (const k of SUPPORTS) assert.equal(typeof d.supports[k], 'boolean', `${id}.supports.${k}`);
    assert.ok(Object.isFrozen(d) && Object.isFrozen(d.supports), `${id} descriptor must be frozen`);
  }
});

test('exactly one runtime has no arm prefix, and prefixes are unique and do not shadow each other', () => {
  const prefixes = entries.map(([, d]) => d.armPrefix);
  assert.equal(prefixes.filter((p) => p === '').length, 1);
  const set = prefixes.filter(Boolean);
  assert.equal(new Set(set).size, set.length);
  for (const a of set) for (const b of set) if (a !== b) assert.ok(!a.startsWith(b), `${a} starts with ${b}`);
});

test('arm prefix round trip: spec, resolved arm, runtime and harness agree for every runtime', () => {
  for (const [id, d] of entries) {
    const spec = `${d.armPrefix}vanilla`;
    const parsed = parseArmSpec(spec);
    assert.equal(parsed.kind, 'vanilla');
    if (d.armPrefix) assert.equal(parsed[d.armPrefix.slice(0, -1)], true, `${spec} flag`);
    const arm = resolveArm(spec, '/nonexistent');
    assert.equal(arm.id, spec);
    assert.equal(arm.runtime, id);
    assert.equal(runtimeOf(arm), id);
    assert.equal(harnessFor(arm).id, id);
  }
});

test('the exported oc- and cc- prefixes still match their descriptors', () => {
  assert.equal(OC_PREFIX, registry.opencode.armPrefix);
  assert.equal(CC_PREFIX, registry['claude-code'].armPrefix);
});
