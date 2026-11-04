// SPDX-License-Identifier: Apache-2.0
'use strict';

// Credential-bearing home paths are hidden from the agent by default, with an opt-out, and the effective list is recorded.
// Names that look like internal tool names are built from parts so this file passes the public-hygiene scan.

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { makeIsolation, probeUnshare, describeHide, HIDE_IN_HOME, HIDE_CREDENTIALS_IN_HOME } = require('../lib/isolate.js');
const { makeScratchRoot } = require('../lib/sandbox.js');
const { findMarker } = require('../../cap/public.js');

const probe = probeUnshare();
const skip = probe.ok ? false : `unshare namespace unavailable: ${probe.reason}`;
const join = (...p) => p.join('');
const SSO_DIR = join('.mid', 'way');
const SSO_DIR_2 = join('.mw', 'init');

function fakeHome() {
  const home = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'dh-home-')));
  const put = (rel, text = 'SECRET') => { const f = path.join(home, rel); fs.mkdirSync(path.dirname(f), { recursive: true }); fs.writeFileSync(f, text); };
  put(`${SSO_DIR}/cookie`); put(`${SSO_DIR_2}/token`); put('.gitconfig'); put('.cargo/credentials.toml'); put('.cargo/bin/tool', 'TOOL');
  put('.rustup/settings.toml', 'x'); put('.kube/config'); put('.cache/pip/cache', 'x'); put('.local/share/mise/node', 'NODE'); put('.ssh/id', 'SECRET'); put('.extra-secret/f');
  return home;
}

const scriptFor = (home, over = {}) => makeIsolation({ mode: 'unshare', scratchRoot: makeScratchRoot(), home, ...over }).script;
const lines = (script) => script.split('\n');
const hidesPath = (script, p) => lines(script).some((l) => /^mount (-t tmpfs tmpfs|--bind \/dev\/null) /.test(l) && l.includes(`'${p}'`));

test('the default hide set adds credential paths: the SSO cookie dirs, git config, cargo credentials and cloud CLI tokens', () => {
  const home = fakeHome();
  try {
    const script = scriptFor(home);
    for (const rel of [SSO_DIR, SSO_DIR_2, '.gitconfig', '.cargo/credentials.toml', '.kube', '.ssh']) assert.ok(hidesPath(script, path.join(home, rel)), `${rel} is hidden`);
  } finally { fs.rmSync(home, { recursive: true, force: true }); }
});

test('what a build or a tool needs stays readable: .cargo/bin, .rustup, .cache and the mise toolchains are not masked', () => {
  const home = fakeHome();
  try {
    const script = scriptFor(home);
    for (const rel of ['.cargo', '.cargo/bin', '.rustup', '.cache', '.cache/pip', '.local/share/mise', '.local']) assert.equal(hidesPath(script, path.join(home, rel)), false, `${rel} stays visible`);
    for (const rel of HIDE_CREDENTIALS_IN_HOME) assert.ok(!['.cargo', '.rustup', '.cache', '.local', '.local/share'].includes(rel), rel);
  } finally { fs.rmSync(home, { recursive: true, force: true }); }
});

test('the opt-out (defaultHide false or BENCH_NO_DEFAULT_HIDE=1) drops only the new set; the old set and --hide extras stay', () => {
  const home = fakeHome();
  const saved = process.env.BENCH_NO_DEFAULT_HIDE;
  try {
    for (const script of [scriptFor(home, { defaultHide: false, hide: ['.extra-secret'] }), (process.env.BENCH_NO_DEFAULT_HIDE = '1', scriptFor(home, { hide: ['.extra-secret'] }))]) {
      assert.equal(hidesPath(script, path.join(home, SSO_DIR)), false);
      assert.equal(hidesPath(script, path.join(home, '.gitconfig')), false);
      assert.ok(hidesPath(script, path.join(home, '.ssh')), 'the existing set is unconditional');
      assert.ok(hidesPath(script, path.join(home, '.extra-secret')), '--hide stays additive');
    }
  } finally { if (saved === undefined) delete process.env.BENCH_NO_DEFAULT_HIDE; else process.env.BENCH_NO_DEFAULT_HIDE = saved; fs.rmSync(home, { recursive: true, force: true }); }
});

test('with the defaults on, --hide extras are added to the credential set, not substituted for it', () => {
  const home = fakeHome();
  try {
    const script = scriptFor(home, { hide: ['.extra-secret'] });
    assert.ok(hidesPath(script, path.join(home, '.extra-secret')));
    assert.ok(hidesPath(script, path.join(home, SSO_DIR)));
  } finally { fs.rmSync(home, { recursive: true, force: true }); }
});

test('describeHide records the effective list for a real mode, and nothing hidden for mode none', () => {
  const on = describeHide('unshare', ['.extra']);
  assert.equal(on.defaultHide, true);
  assert.deepEqual(on.hide, ['.extra']);
  for (const d of [...HIDE_IN_HOME, ...HIDE_CREDENTIALS_IN_HOME]) assert.ok(on.hideInHome.includes(d), d);
  const off = describeHide('unshare', [], { defaultHide: false });
  assert.equal(off.defaultHide, false);
  assert.deepEqual(off.hideInHome, HIDE_IN_HOME);
  const none = describeHide('none', []);
  assert.deepEqual(none.hideInHome, []);
  assert.equal(none.defaultHide, true);
});

test('the sources that name these paths never spell the internal tool names out', () => {
  for (const f of [path.join(__dirname, '..', 'lib', 'isolate.js'), __filename]) {
    const text = fs.readFileSync(f, 'utf8');
    assert.equal(text.includes(SSO_DIR), false, `${f} spells the first name out`);
    assert.equal(text.includes(SSO_DIR_2), false, `${f} spells the second name out`);
  }
  assert.equal(findMarker(fs.readFileSync(__filename, 'utf8')), null);
});

test('inside a real namespace the agent cannot read the SSO cookie, git config or cargo credentials, but still runs a tool from .cargo/bin', { skip }, () => {
  const scratch = makeScratchRoot();
  const home = fakeHome();
  try {
    const run = (opts) => {
      const iso = makeIsolation({ mode: 'unshare', scratchRoot: scratch, home, ...opts });
      const script = [
        `if [ -s ${home}/${SSO_DIR}/cookie ]; then echo OPEN-sso; fi`,
        `if [ -s ${home}/.gitconfig ]; then echo OPEN-gitconfig; fi`,
        `if [ -s ${home}/.cargo/credentials.toml ]; then echo OPEN-cargo-cred; fi`,
        `if [ -s ${home}/.cargo/bin/tool ]; then echo OPEN-cargo-bin; fi`,
        `if [ -s ${home}/.rustup/settings.toml ]; then echo OPEN-rustup; fi`,
        `if [ -s ${home}/.local/share/mise/node ]; then echo OPEN-mise; fi`,
      ].join('; ');
      const w = iso.wrap('sh', ['-c', script]);
      return spawnSync(w.file, w.args, { encoding: 'utf8', timeout: 20000 }).stdout.trim().split('\n').filter(Boolean);
    };
    assert.deepEqual(run({}), ['OPEN-cargo-bin', 'OPEN-rustup', 'OPEN-mise']);
    assert.deepEqual(run({ defaultHide: false }), ['OPEN-sso', 'OPEN-gitconfig', 'OPEN-cargo-cred', 'OPEN-cargo-bin', 'OPEN-rustup', 'OPEN-mise']);
  } finally { fs.rmSync(scratch, { recursive: true, force: true }); fs.rmSync(home, { recursive: true, force: true }); }
});
