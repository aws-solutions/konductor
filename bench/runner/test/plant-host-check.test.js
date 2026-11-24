// SPDX-License-Identifier: Apache-2.0
'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { hostCheck, cmdPlantHostCheck, formatHostCheck } = require('../lib/plant/host-check.js');
const { sha256File } = require('../lib/sandbox.js');
const { AGENT_ENGINES } = require('../lib/harness/runtime.js');
const { checkArgs } = require('../lib/cli-flags.js');
const { writeRelease, makeKey } = require('./plant-release-fixture.js');

const POLICY = { 'policy/plant.cedar': 'permit(principal, action, resource);\n', 'policy/plant.cedarschema': '{}\n', 'sensor-limits.json': '{}\n' };

/** A signed stub release that pins the fake Kiro CLI at `bin`, in a new dir; `t.after` removes it. */
function fixture(t, { manifest = {} } = {}) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'phc-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const bin = path.join(root, 'kiro-cli');
  fs.writeFileSync(bin, '#!/bin/sh\necho kiro-cli 9.9.9\n', { mode: 0o755 });
  const kiroCli = { version: 'kiro-cli 9.9.9', sha256: sha256File(bin), engine: AGENT_ENGINES[0] };
  const rel = writeRelease(path.join(root, 'release'), { files: POLICY, manifest: { versions: { kiroCli }, ...manifest } });
  const outDir = path.join(root, 'out');
  fs.mkdirSync(outDir);
  return { root, bin, rel, outDir };
}

/** Stub host facts for a quiet Linux host with namespaces, a low load, matching wheels and its own out filesystem. */
function quietHost(f, over = {}) {
  return {
    release: f.rel.dir, sha256: f.rel.sha256, kiroBin: f.bin, outDir: f.outDir, keys: f.rel.keys, privateParent: f.root,
    platform: 'linux', probeUnshare: () => ({ ok: true, reason: null }), noiseOf: () => [], loadavg: () => [0.5, 0.5, 0.5],
    versionOfBin: () => 'kiro-cli 9.9.9', checkWheels: () => {}, checkOutFilesystem: () => {},
    ...over,
  };
}

const gate = (r, id) => r.gates.find((g) => g.id === id);

test('a quiet host with namespaces and the pinned build is ready for a counted run', (t) => {
  const f = fixture(t);
  const r = hostCheck(quietHost(f));
  assert.equal(r.ready, true, JSON.stringify(r.gates));
  assert.deepEqual(r.gates.filter((g) => g.status !== 'pass').map((g) => g.id), ['strands-pin']);
  assert.equal(gate(r, 'strands-pin').status, 'info');
});

test('listeners outside the allowlist fail the quiet-host gate and name each listener', (t) => {
  const f = fixture(t);
  const r = hostCheck(quietHost(f, { noiseOf: () => ['tcp 127.0.0.1:8080', 'udp 0.0.0.0:5353'] }));
  assert.equal(r.ready, false);
  assert.equal(gate(r, 'quiet-host').status, 'fail');
  assert.match(gate(r, 'quiet-host').detail, /tcp 127\.0\.0\.1:8080, udp 0\.0\.0\.0:5353/);
  assert.match(gate(r, 'quiet-host').fix, /stop/i);
});

test('a host that refuses user namespaces fails the sandbox gate with the probe reason', (t) => {
  const f = fixture(t);
  const r = hostCheck(quietHost(f, { probeUnshare: () => ({ ok: false, reason: 'unshare: Operation not permitted' }) }));
  assert.equal(r.ready, false);
  assert.equal(gate(r, 'sandbox').status, 'fail');
  assert.match(gate(r, 'sandbox').detail, /Operation not permitted/);
});

test('a host that is not Linux fails the sandbox gate without probing', (t) => {
  const f = fixture(t);
  let probed = false;
  const r = hostCheck(quietHost(f, { platform: 'darwin', probeUnshare: () => { probed = true; return { ok: true }; } }));
  assert.equal(gate(r, 'sandbox').status, 'fail');
  assert.equal(probed, false);
});

test('a wrong manifest hash fails intake and skips every gate that reads the release', (t) => {
  const f = fixture(t);
  const r = hostCheck(quietHost(f, { sha256: '0'.repeat(64) }));
  assert.equal(r.ready, false);
  assert.equal(gate(r, 'release').status, 'fail');
  for (const id of ['quiet-host', 'kiro-pin', 'wheels', 'strands-pin']) assert.equal(gate(r, id).status, 'skip', id);
  assert.equal(gate(r, 'sandbox').status, 'pass');
});

test('a Kiro CLI build other than the pin fails the pin gate', (t) => {
  const f = fixture(t);
  const r = hostCheck(quietHost(f, { versionOfBin: () => 'kiro-cli 3.5.0' }));
  assert.equal(gate(r, 'kiro-pin').status, 'fail');
  assert.match(gate(r, 'kiro-pin').detail, /not the pinned kiro-cli 9\.9\.9/);
});

test('no Kiro CLI found fails the pin gate with the fix', (t) => {
  const f = fixture(t);
  const r = hostCheck(quietHost(f, { kiroBin: null, resolveKiroCli: () => { throw new Error('kiro-cli not found on PATH'); } }));
  assert.equal(gate(r, 'kiro-pin').status, 'fail');
  assert.match(gate(r, 'kiro-pin').fix, /--kiro-bin/);
});

test('a load of 4 or more fails the load gate; wheels and out-dir refusals fail their gates', (t) => {
  const f = fixture(t);
  const boom = (msg) => () => { throw new Error(msg); };
  const r = hostCheck(quietHost(f, { loadavg: () => [7.2, 6, 5], checkWheels: boom('other wheels'), checkOutFilesystem: boom('same filesystem as home') }));
  assert.equal(gate(r, 'load').status, 'fail');
  assert.match(gate(r, 'load').detail, /7\.2/);
  assert.equal(gate(r, 'wheels').status, 'fail');
  assert.equal(gate(r, 'out-dir').status, 'fail');
  assert.match(gate(r, 'out-dir').detail, /same filesystem as home/);
});

test('the toy key fails the release gate: a toy release never counts', (t) => {
  const key = makeKey('toy');
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'phc-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const rel = writeRelease(path.join(root, 'release'), { files: POLICY, key });
  const out = path.join(root, 'out');
  fs.mkdirSync(out);
  const r = hostCheck(quietHost({ root, bin: '/bin/true', rel, outDir: out }));
  assert.equal(gate(r, 'release').status, 'fail');
  assert.match(gate(r, 'release').detail, /toy/);
});

test('a release that pins strands-agents reports the pin as info', (t) => {
  const f = fixture(t, { manifest: { versions: { kiroCli: null, strands: { version: '1.65.0' } } } });
  const r = hostCheck(quietHost(f));
  assert.equal(gate(r, 'strands-pin').status, 'info');
  assert.match(gate(r, 'strands-pin').detail, /1\.65\.0/);
});

test('the check removes its private release copy', (t) => {
  const f = fixture(t);
  const before = fs.readdirSync(f.root).sort();
  hostCheck(quietHost(f));
  hostCheck(quietHost(f, { sha256: '0'.repeat(64) }));
  assert.deepEqual(fs.readdirSync(f.root).sort(), before);
});

test('the text form prints one line per gate and the verdict', (t) => {
  const f = fixture(t);
  const text = formatHostCheck(hostCheck(quietHost(f, { noiseOf: () => ['tcp 127.0.0.1:1'] })));
  assert.match(text, /^FAIL {2}quiet-host/m);
  assert.match(text, /^PASS {2}sandbox/m);
  assert.match(text, /counted plant run here: NO/);
});

test('the command exits 2 on missing flags, 1 when not ready, 0 when ready, and prints JSON with --json', (t) => {
  const f = fixture(t);
  const before = process.exitCode;
  const lines = [];
  const log = (s) => lines.push(s);
  try {
    cmdPlantHostCheck({}, {}, log);
    assert.equal(process.exitCode, 2);
    cmdPlantHostCheck({ release: f.rel.dir, 'release-sha256': f.rel.sha256, json: true }, quietHost(f, { noiseOf: () => ['tcp 127.0.0.1:1'] }), log);
    assert.equal(process.exitCode, 1);
    assert.equal(JSON.parse(lines.at(-1)).ready, false);
    cmdPlantHostCheck({ release: f.rel.dir, 'release-sha256': f.rel.sha256 }, quietHost(f), log);
    assert.equal(process.exitCode, 0);
    assert.match(lines.at(-1), /counted plant run here: YES/);
  } finally {
    process.exitCode = before;
  }
});

test('plant-host-check takes only its own flags', () => {
  assert.equal(checkArgs('plant-host-check', { _: [], release: 'r', 'release-sha256': 'x', 'kiro-bin': 'k', 'plant-python': 'p', out: 'o', json: true }), null);
  assert.match(checkArgs('plant-host-check', { _: [], arms: 'x' }), /unknown flag --arms/);
});
