// SPDX-License-Identifier: Apache-2.0
'use strict';

// The arm build runs cargo on an arbitrary ref, and build.rs of that ref runs with the user's privileges. The build gets an
// allowlisted environment and a scratch HOME; credentials in the invoking shell are not passed. A fake cargo records what it sees.

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { tmp, write } = require('./helpers.js');
const sandbox = require('../lib/sandbox.js');
const { buildBuildEnv } = require('../lib/env.js');

const SECRETS = {
  AWS_ACCESS_KEY_ID: ['AKIA', 'PLANTEDPLANTED01'].join(''),
  AWS_SECRET_ACCESS_KEY: 'planted-secret-value-0001',
  AWS_SESSION_TOKEN: 'planted-session-token-0002',
  AWS_PROFILE: 'planted-profile',
  GITHUB_TOKEN: 'planted-forge-token-0003',
  CARGO_REGISTRY_TOKEN: 'planted-registry-token-0004',
  CARGO_REGISTRIES_PRIVATE_TOKEN: 'planted-registry-token-0005',
  SSH_AUTH_SOCK: '/tmp/planted-agent.sock',
  KIRO_API_KEY: 'planted-kiro-key-0006',
  BUILDER_PASSWORD: 'planted-password-0007',
  HTTPS_PROXY: 'http://user:planted-proxy-pass@proxy.invalid:3128',
  LOGIN_COOKIE: 'planted-cookie-0008',
};

function withEnv(env, fn) {
  const prev = {};
  for (const [k, v] of Object.entries(env)) { prev[k] = process.env[k]; if (v === undefined) delete process.env[k]; else process.env[k] = v; }
  try { return fn(); } finally { for (const [k, v] of Object.entries(prev)) { if (v === undefined) delete process.env[k]; else process.env[k] = v; } }
}

function setup() {
  const root = tmp();
  const bin = path.join(root, 'bin');
  const dump = path.join(root, 'cargo-env.txt');
  write(path.join(bin, 'cargo'), `#!/bin/sh\n{ env; echo "PWD=$(pwd)"; echo "ARGS=$*"; } > "${dump}.$$"\ncat "${dump}.$$" >> "${dump}"\nrm -f "${dump}.$$"\nmkdir -p "$CARGO_TARGET_DIR/release"\n: > "$CARGO_TARGET_DIR/release/konductor"\n: > "$CARGO_TARGET_DIR/release/skill-lookup-mcp"\nexit 0\n`);
  fs.chmodSync(path.join(bin, 'cargo'), 0o755);
  const exportDir = path.join(root, 'src');
  write(path.join(exportDir, 'mcp/Cargo.toml'), '[package]\n');
  write(path.join(exportDir, 'cli/konductor-rs/Cargo.toml'), '[package]\n');
  const realCargo = path.join(root, 'real-home/.cargo');
  const realRustup = path.join(root, 'real-home/.rustup');
  fs.mkdirSync(realCargo, { recursive: true });
  fs.mkdirSync(realRustup, { recursive: true });
  const ctx = { cargoOnline: false, cargoTarget: path.join(root, 'target') };
  const env = { ...SECRETS, PATH: `${bin}${path.delimiter}${process.env.PATH}`, HOME: path.join(root, 'real-home'), CARGO_HOME: realCargo, RUSTUP_HOME: realRustup, CC: 'planted-cc', RUSTFLAGS: '-C debuginfo=0' };
  return { root, dump, exportDir, ctx, env, realCargo, realRustup, done: () => fs.rmSync(root, { recursive: true, force: true }) };
}

const parse = (file) => Object.fromEntries(fs.readFileSync(file, 'utf8').split('\n').filter((l) => l.includes('=')).map((l) => [l.slice(0, l.indexOf('=')), l.slice(l.indexOf('=') + 1)]));

test('buildMcp and buildCli run cargo without credentials from the invoking shell', () => {
  const s = setup();
  try {
    withEnv(s.env, () => {
      sandbox.buildMcp(s.exportDir, s.ctx);
      sandbox.buildCli(s.exportDir, path.join(s.root, 'konductor-bin'), s.ctx);
    });
    const text = fs.readFileSync(s.dump, 'utf8');
    for (const [name, value] of Object.entries(SECRETS)) {
      assert.ok(!text.includes(`${name}=`), `${name} reached cargo`);
      assert.ok(!text.includes(value), `the value of ${name} reached cargo`);
    }
    assert.equal((text.match(/^ARGS=/gm) || []).length, 2, 'cargo ran for both builds');
  } finally { s.done(); }
});

test('the build keeps what a toolchain needs: PATH, toolchain flags, the real CARGO_HOME and RUSTUP_HOME, a scratch HOME', () => {
  const s = setup();
  try {
    withEnv(s.env, () => sandbox.buildMcp(s.exportDir, s.ctx));
    const seen = parse(s.dump);
    assert.ok(seen.PATH.startsWith(path.join(s.root, 'bin')));
    assert.equal(seen.CC, 'planted-cc');
    assert.equal(seen.RUSTFLAGS, '-C debuginfo=0');
    assert.equal(seen.CARGO_HOME, s.realCargo);
    assert.equal(seen.RUSTUP_HOME, s.realRustup);
    assert.equal(seen.CARGO_TARGET_DIR, `${s.ctx.cargoTarget}-mcp`);
    assert.notEqual(seen.HOME, s.env.HOME, 'not the invoking user home');
    assert.ok(seen.HOME.startsWith(require('node:os').tmpdir()), seen.HOME);
    assert.equal(fs.existsSync(seen.HOME), false, 'the scratch HOME is removed after the build');
    assert.match(seen.ARGS, /build --release --workspace --manifest-path .*mcp\/Cargo\.toml --offline/);
  } finally { s.done(); }
});

test('proxy variables are passed only for an online build, and a credential in one is not logged by the runner', () => {
  const s = setup();
  try {
    const offline = withEnv(s.env, () => buildBuildEnv(process.env, { home: '/scratch', cargoTarget: '/t', online: false }));
    assert.equal(offline.env.HTTPS_PROXY, undefined);
    const online = withEnv(s.env, () => buildBuildEnv(process.env, { home: '/scratch', cargoTarget: '/t', online: true }));
    assert.equal(online.env.HTTPS_PROXY, SECRETS.HTTPS_PROXY, 'an online build may need the proxy');
    assert.ok(!JSON.stringify(online.set).includes('planted-proxy-pass'), 'the record of what was set redacts a credential in a URL');
  } finally { s.done(); }
});

test('BENCH_BUILD_ENV_KEEP passes named non-secret variables and refuses a credential-looking name', () => {
  const s = setup();
  try {
    const r = withEnv({ ...s.env, BENCH_BUILD_ENV_KEEP: 'MY_LIB_DIR,BUILDER_PASSWORD', MY_LIB_DIR: '/opt/lib' }, () => buildBuildEnv(process.env, { home: '/scratch', cargoTarget: '/t', online: false }));
    assert.equal(r.env.MY_LIB_DIR, '/opt/lib');
    assert.equal(r.env.BUILDER_PASSWORD, undefined);
    assert.deepEqual(r.refused, ['BUILDER_PASSWORD']);
  } finally { s.done(); }
});

test('a build refuses to start when BENCH_BUILD_ENV_KEEP names a credential', () => {
  const s = setup();
  try {
    withEnv({ ...s.env, BENCH_BUILD_ENV_KEEP: 'GITHUB_TOKEN' }, () => {
      assert.throws(() => sandbox.buildMcp(s.exportDir, s.ctx), /BENCH_BUILD_ENV_KEEP names look like credentials and are refused: GITHUB_TOKEN/);
    });
    assert.equal(fs.existsSync(s.dump), false, 'cargo never ran');
  } finally { s.done(); }
});
