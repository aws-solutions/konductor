// SPDX-License-Identifier: Apache-2.0
'use strict';

// resolveKiroCli unwraps the toolbox shim and the sandbox wrapper to the native kiro-cli binary, or names --kiro-bin.

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { tmp, write } = require('./helpers.js');
const { resolveKiroCli, isNativeBinary } = require('../lib/sandbox.js');

const ELF = Buffer.concat([Buffer.from([0x7f, 0x45, 0x4c, 0x46, 2, 1, 1, 0]), Buffer.alloc(64)]);
const exe = (file, body) => { fs.mkdirSync(path.dirname(file), { recursive: true }); fs.writeFileSync(file, body); fs.chmodSync(file, 0o755); };

// <root>/bin/kiro-cli -> <root>/tools/toolbox/1.0/toolbox-exec; the tool records name version 3.4.0 and its sandbox wrapper.
function toolbox(root, { native = true, bundle = 'sandbox/kiro-cli' } = {}) {
  exe(path.join(root, 'tools/toolbox/1.0/toolbox-exec'), ELF);
  fs.mkdirSync(path.join(root, 'bin'), { recursive: true });
  fs.symlinkSync(path.join(root, 'tools/toolbox/1.0/toolbox-exec'), path.join(root, 'bin/kiro-cli'));
  write(path.join(root, 'tools/kiro-cli/info.json'), JSON.stringify({ Name: 'kiro-cli', CurrentVersion: { Version: '3.4.0' } }));
  write(path.join(root, 'tools/kiro-cli/3.4.0.json'), JSON.stringify({ Executables: { 'kiro-cli': { BundlePath: bundle } } }));
  exe(path.join(root, 'tools/kiro-cli/3.4.0/sandbox/kiro-cli'), '#!/bin/bash\nexec launcher "$@"\n');
  exe(path.join(root, 'tools/kiro-cli/3.4.0/kiro-cli'), native ? ELF : '#!/bin/sh\nexit 0\n');
  return path.join(root, 'bin');
}

test('a toolbox shim resolves through the tool records and the sandbox wrapper to the native binary', () => {
  const root = tmp();
  try {
    const r = resolveKiroCli(toolbox(root));
    assert.equal(r.bin, fs.realpathSync(path.join(root, 'tools/kiro-cli/3.4.0/kiro-cli')));
    assert.match(r.shim, /toolbox-exec -> .*sandbox\/kiro-cli$/);
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});

test('the sandbox wrapper alone (as linked from a bin directory) resolves to the binary next to it', () => {
  const root = tmp();
  try {
    toolbox(root);
    fs.mkdirSync(path.join(root, 'local'));
    fs.symlinkSync(path.join(root, 'tools/kiro-cli/3.4.0/sandbox/kiro-cli'), path.join(root, 'local/kiro-cli'));
    const r = resolveKiroCli(path.join(root, 'local'));
    assert.equal(r.bin, fs.realpathSync(path.join(root, 'tools/kiro-cli/3.4.0/kiro-cli')));
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});

test('a known launcher that leads to no native binary is an error naming --kiro-bin', () => {
  const root = tmp();
  try {
    assert.throws(() => resolveKiroCli(toolbox(root, { native: false })), /not a native binary either; pass the native kiro-cli binary with --kiro-bin PATH/);
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
  const bare = tmp();
  try {
    exe(path.join(bare, 'tools/toolbox/1.0/toolbox-exec'), ELF);
    fs.mkdirSync(path.join(bare, 'bin'));
    fs.symlinkSync(path.join(bare, 'tools/toolbox/1.0/toolbox-exec'), path.join(bare, 'bin/kiro-cli'));
    assert.throws(() => resolveKiroCli(path.join(bare, 'bin')), /toolbox shim .* could not be found from the toolbox records; pass the native kiro-cli binary with --kiro-bin PATH/);
  } finally { fs.rmSync(bare, { recursive: true, force: true }); }
});

test('any other kiro-cli is used as found, and an empty PATH names --kiro-bin', () => {
  const root = tmp();
  try {
    exe(path.join(root, 'kiro-cli'), '#!/usr/bin/env node\n');
    assert.deepEqual(resolveKiroCli(root), { bin: fs.realpathSync(path.join(root, 'kiro-cli')), shim: null });
    assert.throws(() => resolveKiroCli(path.join(root, 'none')), /kiro-cli not found on PATH; pass the kiro-cli binary with --kiro-bin PATH/);
    assert.equal(isNativeBinary(path.join(root, 'kiro-cli')), false);
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});
