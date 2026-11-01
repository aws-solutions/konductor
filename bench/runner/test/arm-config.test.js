// SPDX-License-Identifier: Apache-2.0
'use strict';

// --arm-config name=key.path=value: keys put into the arm's scratch ~/.konductor/config.yml after the install.

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { tmp } = require('./helpers.js');
const armConfig = require('../lib/arm-config.js');
const { applyArmOptions } = require('../lib/arm-opts.js');
const { kiro } = require('../lib/harness/index.js');
const { buildResult } = require('../lib/result.js');
const { checkArgs } = require('../lib/cli-flags.js');
const { aggregateStream } = require('../lib/stream.js');

const arms = () => [
  { id: 'vanilla', vanilla: true },
  { id: 'orch', vanilla: false, agent: 'konductor' },
  { id: 'orch-coord', vanilla: false, agent: 'konductor' },
];

test('parseArmConfig reads one or several keys per arm and nests dotted paths', () => {
  const m = armConfig.parseArmConfig('orch-coord=orchestration.mode=coordinator,orch=a.b=true;a.c=3;d=x y');
  assert.deepEqual(m.get('orch-coord'), { orchestration: { mode: 'coordinator' } });
  assert.deepEqual(m.get('orch'), { a: { b: true, c: 3 }, d: 'x y' });
  assert.equal(armConfig.parseArmConfig(undefined).size, 0);
});

test('parseArmConfig refuses a bad key, a missing value, a repeated key and a bad orchestration.mode', () => {
  assert.throws(() => armConfig.parseArmConfig('orch=orchestration.mode'), /key\.path=value/);
  assert.throws(() => armConfig.parseArmConfig('orch=.mode=x'), /not a valid key path/);
  assert.throws(() => armConfig.parseArmConfig('orch=a b=1'), /not a valid key path/);
  assert.throws(() => armConfig.parseArmConfig('orch=a=1;a=2'), /twice/);
  assert.throws(() => armConfig.parseArmConfig('orch=a.b=1;a=2'), /conflicts/);
  assert.throws(() => armConfig.parseArmConfig('orch=orchestration.mode=strict'), /auto or coordinator/);
  assert.throws(() => armConfig.parseArmConfig('orch=orchestration.mdoe=coordinator'), /unknown orchestration key "mdoe"/);
});

test('renderYaml writes nested mappings, quotes only when needed, and ends with a newline', () => {
  assert.equal(armConfig.renderYaml({ orchestration: { mode: 'coordinator' } }), 'orchestration:\n  mode: coordinator\n');
  assert.equal(armConfig.renderYaml({ tier: 'minor', flag: true, n: 3, s: 'a: b' }), 'tier: minor\nflag: true\nn: 3\ns: "a: b"\n');
  assert.equal(armConfig.renderYaml({ s: 'yes' }), 's: "yes"\n', 'a word YAML reads as a boolean is quoted');
});

test('applyArmOptions attaches the config to the named arm and records it', () => {
  const a = arms();
  const rec = applyArmOptions(a, { 'arm-config': 'orch-coord=orchestration.mode=coordinator' });
  assert.deepEqual(a[2].armConfig, { orchestration: { mode: 'coordinator' } });
  assert.equal(a[1].armConfig, undefined);
  assert.deepEqual(rec.armConfig, { 'orch-coord': { orchestration: { mode: 'coordinator' } } });
});

test('applyArmOptions refuses an unknown arm and the vanilla arm', () => {
  assert.throws(() => applyArmOptions(arms(), { 'arm-config': 'nope=a.b=1' }), /arm "nope" is not among --arms/);
  assert.throws(() => applyArmOptions(arms(), { 'arm-config': 'vanilla=a.b=1' }), /vanilla has no konductor config/);
});

test('the flag is accepted by run and spelled in the usage', () => {
  assert.equal(checkArgs('run', { _: [], 'arm-config': 'a=b.c=d' }), null);
  assert.match(fs.readFileSync(path.join(__dirname, '..', 'bench.js'), 'utf8'), /--arm-config/);
});

test('writeArmConfig writes ~/.konductor/config.yml in the scratch home and refuses to overwrite one', () => {
  const home = tmp();
  try {
    const file = armConfig.writeArmConfig(home, { orchestration: { mode: 'coordinator' } });
    assert.equal(file, path.join(home, '.konductor', 'config.yml'));
    assert.equal(fs.readFileSync(file, 'utf8'), 'orchestration:\n  mode: coordinator\n');
    assert.throws(() => armConfig.writeArmConfig(home, { a: { b: 1 } }), /already exists/);
  } finally { fs.rmSync(home, { recursive: true, force: true }); }
});

test('the kiro harness writes the arm config after the install and before the agent starts', () => {
  const root = tmp();
  try {
    const bin = path.join(root, 'konductor');
    fs.writeFileSync(bin, '#!/bin/sh\nmkdir -p "$HOME/.konductor/installs"\necho installed\n', { mode: 0o755 });
    const authDb = path.join(root, 'data.sqlite3');
    fs.writeFileSync(authDb, 'fake-auth');
    const home = path.join(root, 'home');
    fs.mkdirSync(home);
    const outDir = path.join(root, 'out');
    fs.mkdirSync(outDir);
    const arm = { id: 'orch-coord', vanilla: false, agent: 'konductor', armConfig: { orchestration: { mode: 'coordinator' } } };
    kiro.installInto(home, { arm, prepared: { bin, exportDir: path.join(root, 'src') }, ctx: { authDb }, config: { model: 'm', agentEngine: 'v3' }, outDir });
    assert.equal(fs.readFileSync(path.join(home, '.konductor/config.yml'), 'utf8'), 'orchestration:\n  mode: coordinator\n');
    const plain = path.join(root, 'home2');
    fs.mkdirSync(plain);
    kiro.installInto(plain, { arm: { ...arm, armConfig: undefined }, prepared: { bin, exportDir: path.join(root, 'src') }, ctx: { authDb }, config: { model: 'm', agentEngine: 'v3' }, outDir });
    assert.equal(fs.existsSync(path.join(plain, '.konductor/config.yml')), false, 'an arm without options gets no file');
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});

test('result.json records the arm config', () => {
  const agg = aggregateStream([{ type: 'runFinished', data: { status: 'success', stopReason: 'end_turn', finalText: 'done', finalTextTruncated: false } }]);
  const r = buildResult({
    arm: { id: 'orch-coord', label: 'orch-coord', ref: 'x', commitSha: 'abc', harness: 'kiro-cli-v2', runtime: 'kiro-cli', agent: 'konductor', vanilla: false, armConfig: { orchestration: { mode: 'coordinator' } } },
    task: { id: 't1' }, replicate: 1, config: { model: 'm', effort: 'high', agentEngine: 'v3' }, exec: { timedOut: false, exitCode: 0, wallClockMs: 1 },
    agg, session: null, checks: [], transcript: { chars: 1, bytes: 1, partial: false }, env: { kiroCliVersion: 'k', modelListSnapshotPath: null },
  });
  assert.deepEqual(r.armConfig, { orchestration: { mode: 'coordinator' } });
});
