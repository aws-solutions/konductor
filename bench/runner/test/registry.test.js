// SPDX-License-Identifier: Apache-2.0
'use strict';

// The runtime registry: one descriptor per harness, and the lists other modules derive from it.

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { registry, HARNESSES, harnessFor } = require('../lib/harness/index.js');
const { DESCRIPTORS } = require('../lib/harness/descriptors.js');
const { RUNTIMES, USD_RUNTIMES, isUsdRuntime, runtimeOf, descriptorOf, costUnitOf, supporting, notSupporting, joinNames, DEFAULT_RUNTIME } = require('../lib/harness/runtime.js');
const { FLAGS } = require('../lib/cli-flags.js');
const { parseArmSpec, resolveArm, OC_PREFIX, CC_PREFIX } = require('../lib/arms.js');
const { kiroArgs } = require('../../plugins/kiro-cli/harness.js');
const { validateResult } = require('../lib/result.js');

const SCHEMA = JSON.parse(fs.readFileSync(path.join(__dirname, '..', '..', 'schema', 'result.schema.json'), 'utf8'));
const SUPPORTS = ['trace', 'stopOn', 'effort', 'runCreditLimit', 'multiTurn', 'freshSessions', 'capCommands', 'skillStudy', 'agentEngine', 'prepareOnly', 'armConfig'];
const FIELDS = ['id', 'label', 'proseName', 'armPrefix', 'costUnit', 'streamFormat', 'supports', 'flags', 'noPrompt', 'plant', 'multiTurnNote', 'trace', 'report', 'capabilities', 'introspect'];
const STREAM_FORMATS = ['kiro-acp', 'opencode-json', 'claude-stream-json', 'strands-jsonl'];
const CONTRACT = fs.readFileSync(path.join(__dirname, '..', 'lib', 'harness', 'CONTRACT.md'), 'utf8');

// First-column names of the table that follows the header row starting with `header`, in the Descriptor section.
function descriptorTable(header) {
  const section = CONTRACT.slice(CONTRACT.indexOf('\n## Descriptor'));
  const rest = section.slice(section.indexOf(`| ${header} |`));
  const lines = rest.split('\n').slice(2);
  const end = lines.findIndex((l) => !l.startsWith('|'));
  return lines.slice(0, end < 0 ? undefined : end).map((l) => l.match(/^\| `([A-Za-z.]+)`/)?.[1]);
}
const entries = Object.entries(registry);

test('the result schema names no runtime; validateResult accepts every registry harness and refuses another', () => {
  assert.equal(SCHEMA.properties.harness.enum, undefined, 'the registry, not the schema, lists the harnesses');
  const harnessErrors = (harness) => validateResult({ harness }).filter((e) => e.startsWith('$.harness'));
  for (const id of Object.keys(registry)) assert.deepEqual(harnessErrors(id), [], id);
  assert.match(harnessErrors('codex-cli').join(), /"codex-cli" is not a registered harness/);
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
    assert.deepEqual(Object.keys(d).sort(), [...FIELDS].sort(), `${id} fields`);
    assert.ok(Object.isFrozen(d) && Object.isFrozen(d.supports) && Object.isFrozen(d.flags) && Object.isFrozen(d.flags.own) && Object.isFrozen(d.flags.refused) && Object.isFrozen(d.trace), `${id} descriptor must be deeply frozen`);
  }
});

test('exactly one runtime has no arm prefix, and prefixes are unique and do not shadow each other', () => {
  const prefixes = entries.map(([, d]) => d.armPrefix);
  assert.equal(prefixes.filter((p) => p === '').length, 1);
  const set = prefixes.filter(Boolean);
  assert.equal(new Set(set).size, set.length);
  for (const a of set) for (const b of set) if (a !== b) assert.ok(!a.startsWith(b), `${a} starts with ${b}`);
});

// Strands has plant arms only, so its round trip uses one; every other runtime uses its vanilla arm.
const sampleArm = (d) => (d.id === 'strands' ? { spec: `${d.armPrefix}plant-policy`, kind: 'plant' } : { spec: `${d.armPrefix}vanilla`, kind: 'vanilla' });

test('arm prefix round trip: spec, resolved arm, runtime and harness agree for every runtime', () => {
  for (const [id, d] of entries) {
    const { spec, kind } = sampleArm(d);
    const parsed = parseArmSpec(spec);
    assert.equal(parsed.kind, kind);
    if (d.armPrefix) assert.equal(parsed[d.armPrefix.slice(0, -1)], true, `${spec} flag`);
    const arm = resolveArm(spec, '/nonexistent');
    assert.equal(arm.id, spec);
    assert.equal(arm.runtime, id);
    assert.equal(runtimeOf(arm), id);
    assert.equal(harnessFor(arm).id, id);
  }
});

test('noPrompt names the flags and env each runtime uses to skip its own prompts; kiroArgs passes the kiro-cli flags', () => {
  for (const [id, d] of entries) {
    assert.deepEqual(Object.keys(d.noPrompt).sort(), ['env', 'flags', 'note'], `${id}.noPrompt keys`);
    assert.ok(Object.isFrozen(d.noPrompt) && Array.isArray(d.noPrompt.flags) && typeof d.noPrompt.note === 'string', `${id}.noPrompt`);
  }
  const args = kiroArgs({ arm: { vanilla: true, agent: null }, task: { prompt: 'p' }, config: { model: 'm', effort: 'high', agentEngine: 'v2' } });
  for (const flag of registry['kiro-cli'].noPrompt.flags) assert.ok(args.includes(flag), `kiroArgs lacks ${flag}`);
  assert.deepEqual({ ...registry.strands.noPrompt.env }, { BYPASS_TOOL_CONSENT: 'true' });
});

test('the exported oc- and cc- prefixes still match their descriptors', () => {
  assert.equal(OC_PREFIX, registry.opencode.armPrefix);
  assert.equal(CC_PREFIX, registry['claude-code'].armPrefix);
});

test('CONTRACT.md documents exactly the descriptor fields and supports keys', () => {
  assert.deepEqual(descriptorTable('Field').sort(), [...FIELDS].sort());
  assert.deepEqual(descriptorTable('Key').sort(), [...SUPPORTS].sort());
});

test('proseName and streamFormat are set, and the stream format is one the consumers know', () => {
  for (const [id, d] of entries) {
    assert.ok(typeof d.proseName === 'string' && d.proseName.length > 0, `${id}.proseName`);
    assert.ok(STREAM_FORMATS.includes(d.streamFormat), `${id}.streamFormat ${d.streamFormat}`);
  }
});

test('flags: own and refused names are real run flags, own flags belong to one runtime, refusals match supports', () => {
  const owned = entries.flatMap(([, d]) => d.flags.own);
  assert.equal(new Set(owned).size, owned.length, 'a runtime-only flag is listed by one runtime');
  for (const [id, d] of entries) {
    assert.deepEqual(Object.keys(d.flags).sort(), ['own', 'perRunCapFlag', 'refused'], `${id}.flags keys`);
    for (const f of [...d.flags.own, ...Object.keys(d.flags.refused)]) assert.ok(FLAGS.run.includes(f), `${id}: --${f} is not a run flag`);
    for (const [f, why] of Object.entries(d.flags.refused)) assert.ok(typeof why === 'string' && why.length > 0, `${id}: --${f} needs a reason`);
    assert.equal('effort' in d.flags.refused, !d.supports.effort, `${id}: --effort is refused exactly when supports.effort is false`);
    for (const f of ['stop-on', 'max-tool-calls']) assert.equal(f in d.flags.refused, !d.supports.stopOn, `${id}: --${f} is refused exactly when supports.stopOn is false`);
    assert.ok(d.flags.perRunCapFlag === null || d.flags.own.includes(d.flags.perRunCapFlag), `${id}.perRunCapFlag must be one of its own flags`);
  }
});

test('report facts: a USD runtime may name its cost source; factorial keys are unique', () => {
  const keys = [];
  for (const [id, d] of entries) {
    assert.deepEqual(Object.keys(d.report).sort(), ['costWords', 'factorialKey', 'killNote', 'usdNote'], `${id}.report keys`);
    assert.ok(Object.isFrozen(d.report), `${id}.report must be frozen`);
    if (d.costUnit !== 'usd') assert.equal(d.report.usdNote, null, `${id}: only a USD runtime has a usdNote`);
    assert.equal(d.report.killNote === null, d.report.usdNote === null, `${id}: usdNote and killNote come together`);
    if (d.report.factorialKey !== null) keys.push(d.report.factorialKey);
  }
  assert.equal(new Set(keys).size, keys.length, 'one runtime per factorial key');
});

test('capabilities: present exactly when cap commands accept the runtime; one runtime reads acting agents', () => {
  for (const [id, d] of entries) {
    assert.equal(d.capabilities !== null, d.supports.capCommands, `${id}.capabilities is set exactly when supports.capCommands`);
    if (!d.capabilities) continue;
    assert.ok(Object.isFrozen(d.capabilities) && Object.isFrozen(d.capabilities.tools), `${id}.capabilities must be frozen`);
    assert.deepEqual(Object.keys(d.capabilities.tools).sort(), ['agent', 'context', 'skill', 'sop'], `${id}.capabilities.tools keys`);
    assert.ok(['agent-filter', 'skill-index'].includes(d.capabilities.surface), `${id}.capabilities.surface`);
    assert.ok(Number.isInteger(d.capabilities.proxyCallsPerQuery) && d.capabilities.proxyCallsPerQuery > 0, `${id}.capabilities.proxyCallsPerQuery`);
    assert.deepEqual(Object.keys(d.capabilities.forcedLoad).sort(), ['agent', 'skill', 'sop'], `${id}.capabilities.forcedLoad keys`);
    for (const t of Object.values(d.capabilities.forcedLoad)) assert.match(t, /\{name\}/, `${id}.capabilities.forcedLoad names the unit`);
  }
  assert.equal(entries.filter(([, d]) => d.capabilities?.actingAgents).length, 1, 'exactly one runtime reaches capabilities through acting agents');
});

test('multiTurnNote is a sentence exactly when the runtime has no multi-turn support', () => {
  for (const [id, d] of entries) {
    if (d.supports.multiTurn) assert.equal(d.multiTurnNote, null, `${id}.multiTurnNote`);
    else assert.ok(typeof d.multiTurnNote === 'string' && d.multiTurnNote.length > 0, `${id}.multiTurnNote`);
  }
});

test('trace facts: a runtime that supports trace names its time note and skill listing; others carry neutral values', () => {
  for (const [id, d] of entries) {
    assert.deepEqual(Object.keys(d.trace).sort(), ['sessionFiles', 'skillsListing', 'timeNote'], `${id}.trace keys`);
    assert.equal(typeof d.trace.sessionFiles, 'boolean', id);
    if (d.supports.trace) {
      assert.ok(typeof d.trace.timeNote === 'string' && d.trace.timeNote.length > 0, `${id}.trace.timeNote`);
      assert.ok(['agent-filter', 'slash-commands'].includes(d.trace.skillsListing), `${id}.trace.skillsListing`);
    } else {
      assert.deepEqual({ ...d.trace }, { sessionFiles: false, timeNote: null, skillsListing: null }, id);
    }
  }
});

test('descriptor lookups: descriptorOf, costUnitOf, supporting, notSupporting, joinNames', () => {
  for (const [id, d] of entries) {
    assert.equal(descriptorOf(id), d);
    assert.equal(costUnitOf(id), d.costUnit);
  }
  assert.equal(descriptorOf('nonesuch'), registry[DEFAULT_RUNTIME]);
  assert.equal(costUnitOf('nonesuch'), registry[DEFAULT_RUNTIME].costUnit);
  for (const k of SUPPORTS) assert.deepEqual([...supporting(k), ...notSupporting(k)].map((d) => d.id).sort(), Object.keys(registry).sort(), k);
  assert.deepEqual(joinNames([]), '');
  assert.equal(joinNames(['a']), 'a');
  assert.equal(joinNames(['a', 'b']), 'a and b');
  assert.equal(joinNames(['a', 'b', 'c']), 'a, b and c');
});
