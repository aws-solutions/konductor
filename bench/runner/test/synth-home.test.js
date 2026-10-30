// SPDX-License-Identifier: Apache-2.0
'use strict';

// The build step runs the arm's own `konductor synth`. That binary logs under $HOME, so it gets a throwaway HOME.

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { tmp } = require('./helpers.js');
const sandbox = require('../lib/sandbox.js');

// The runner passes an allowlisted environment, so the fake reports next to itself rather than through a variable.
function fakeKonductor(dir) {
  const bin = path.join(dir, 'konductor');
  fs.writeFileSync(bin, `#!/bin/sh
out="$(dirname "$0")/out"
mkdir -p "$out"
printf '%s\\n' "$HOME" > "$out/home"
printf '%s\\n' "$PWD" > "$out/pwd"
printf '%s\\n' "$*" > "$out/args"
`);
  fs.chmodSync(bin, 0o755);
  return bin;
}

test('synthArm runs synth in the export with a scratch HOME that is removed afterwards and is not the real HOME', () => {
  const root = tmp();
  const out = path.join(root, 'out');
  const exportDir = path.join(root, 'src');
  fs.mkdirSync(exportDir);
  const bin = fakeKonductor(root);
  try {
    sandbox.synthArm(bin, exportDir);
    const home = fs.readFileSync(path.join(out, 'home'), 'utf8').trim();
    assert.notEqual(home, os.homedir());
    assert.ok(home.startsWith(os.tmpdir()), home);
    assert.equal(fs.existsSync(home), false, 'scratch HOME is removed');
    assert.equal(fs.readFileSync(path.join(out, 'args'), 'utf8').trim(), `synth --from ${exportDir}`);
    assert.equal(fs.realpathSync(fs.readFileSync(path.join(out, 'pwd'), 'utf8').trim()), fs.realpathSync(exportDir));
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('synthArm removes the scratch HOME and reports the failure when synth exits non-zero', () => {
  const root = tmp();
  const bin = path.join(root, 'konductor');
  fs.writeFileSync(bin, '#!/bin/sh\necho "$HOME" > "$(dirname "$0")/home-seen"\necho boom >&2\nexit 7\n');
  fs.chmodSync(bin, 0o755);
  const marker = path.join(root, 'home-seen');
  try {
    assert.throws(() => sandbox.synthArm(bin, root), /failed \(exit 7\)[\s\S]*boom/);
    assert.equal(fs.existsSync(fs.readFileSync(marker, 'utf8').trim()), false);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('installInto runs the arm install with the run HOME and the allowlisted environment', () => {
  const root = tmp();
  const home = path.join(root, 'home');
  const bin = fakeKonductor(root);
  try {
    sandbox.installInto(home, { bin, exportDir: path.join(root, 'src') });
    assert.equal(fs.readFileSync(path.join(root, 'out', 'home'), 'utf8').trim(), home);
    assert.match(fs.readFileSync(path.join(root, 'out', 'args'), 'utf8'), /^install --harness kiro-cli-v2 /);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('runKonductor refuses the real HOME, so ~/.konductor/installs is never written', () => {
  const root = tmp();
  const bin = fakeKonductor(root);
  try {
    assert.throws(() => sandbox.runKonductor(bin, ['install'], { home: os.homedir() }), /refused to run with the real HOME/);
    assert.throws(() => sandbox.runKonductor(bin, ['install'], {}), /needs a scratch HOME/);
    assert.equal(fs.existsSync(path.join(root, 'out')), false, 'the binary never started');
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});
