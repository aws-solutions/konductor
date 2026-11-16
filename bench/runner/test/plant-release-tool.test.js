// SPDX-License-Identifier: Apache-2.0
'use strict';

// Tests the plant release tool (bench/physical/ci/plant-release.js): key making, pinning, signing and the verify that reuses intake.

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { main, PINNED_KEYS_FILE } = require('../../physical/ci/plant-release.js');
const { PINNED_KEYS } = require('../lib/plant/manifest.js');
const { TASK_ID } = require('./plant-release-fixture.js');

const tmp = [];
const tmpDir = () => { const d = fs.mkdtempSync(path.join(os.tmpdir(), 'kplant-tool-')); tmp.push(d); return d; };
test.after(() => tmp.forEach((d) => fs.rmSync(d, { recursive: true, force: true })));

/** Runs the tool; returns `{code, out, err}`. */
function run(...argv) {
  const sink = (acc) => ({ write: (s) => { acc.text += s; } });
  const out = { text: '' };
  const err = { text: '' };
  const code = main(argv, sink(out), sink(err));
  return { code, out: out.text, err: err.text };
}

/** A work dir with a made key, a pinned-keys file holding only `[]`, and a plain release dir ready to sign. */
function setup() {
  const base = tmpDir();
  const keyDir = path.join(base, 'key');
  assert.equal(run('keygen', '--out', keyDir).code, 0);
  const keys = path.join(base, 'pinned.json');
  fs.writeFileSync(keys, '[]\n');
  const release = path.join(base, 'release');
  fs.mkdirSync(path.join(release, 'tasks'), { recursive: true });
  fs.writeFileSync(path.join(release, 'tasks', `${TASK_ID}.json`), '{}');
  fs.writeFileSync(path.join(release, 'refusal-rule.json'), '{}');
  fs.writeFileSync(path.join(release, 'analysis-plan.md'), 'handledFloor: 0.5\n');
  const fields = path.join(base, 'fields.json');
  fs.writeFileSync(fields, JSON.stringify({ seeds: { [TASK_ID]: 7 }, versions: { kiroCli: { version: '1.0.0', sha256: 'a'.repeat(64), engine: 'v3' } } }));
  return { keyDir, keys, release, fields, privateKey: path.join(keyDir, 'private.pem'), publicKey: path.join(keyDir, 'public.pem') };
}

const signArgs = (s) => ['sign', '--release', s.release, '--key', s.privateKey, '--release-id', 'plant-tool-test', '--fields', s.fields];

/** Sets up, pins the made key in the scratch list and signs. */
function signedRelease() {
  const s = setup();
  assert.equal(run('pin', '--public', s.publicKey, '--keys', s.keys).code, 0);
  assert.equal(run(...signArgs(s)).code, 0);
  return s;
}

test('the checked pinned list is the one manifest.js reads', () => {
  assert.deepEqual(PINNED_KEYS, JSON.parse(fs.readFileSync(PINNED_KEYS_FILE, 'utf8')));
});

test('keygen refuses a dir inside a git repo', () => {
  const repo = tmpDir();
  fs.mkdirSync(path.join(repo, '.git'));
  const r = run('keygen', '--out', path.join(repo, 'sub', 'key'));
  assert.equal(r.code, 2);
  assert.match(r.err, /inside the git repo/);
  assert.equal(fs.existsSync(path.join(repo, 'sub')), false);
});

test('keygen writes the private key with mode 600 in a 700 dir', () => {
  const s = setup();
  assert.equal(fs.statSync(s.privateKey).mode & 0o777, 0o600);
  assert.equal(fs.statSync(s.keyDir).mode & 0o777, 0o700);
});

test('keygen refuses to overwrite an existing key', () => {
  const s = setup();
  const r = run('keygen', '--out', s.keyDir);
  assert.equal(r.code, 2);
  assert.match(r.err, /already exists/);
});

test('keygen prints the key id and the pinned entry', () => {
  const r = run('keygen', '--out', path.join(tmpDir(), 'key'));
  assert.match(r.out, /key id: +[0-9a-f]{64}/);
  assert.match(r.out, /"status":"active"/);
});

test('pin refuses a private key', () => {
  const s = setup();
  const r = run('pin', '--public', s.privateKey, '--keys', s.keys);
  assert.equal(r.code, 2);
  assert.match(r.err, /private key/);
  assert.equal(fs.readFileSync(s.keys, 'utf8'), '[]\n');
});

test('pin adds the public key as active', () => {
  const s = setup();
  assert.equal(run('pin', '--public', s.publicKey, '--keys', s.keys).code, 0);
  const [entry] = JSON.parse(fs.readFileSync(s.keys, 'utf8'));
  assert.equal(entry.status, 'active');
  assert.match(entry.keyId, /^[0-9a-f]{64}$/);
});

test('pin refuses the same key twice', () => {
  const s = setup();
  run('pin', '--public', s.publicKey, '--keys', s.keys);
  assert.match(run('pin', '--public', s.publicKey, '--keys', s.keys).err, /already pinned/);
});

test('sign then verify passes', () => {
  const s = signedRelease();
  const r = run('verify', '--release', s.release, '--keys', s.keys);
  assert.equal(r.code, 0, r.err);
  assert.match(r.out, /verified: release plant-tool-test/);
});

test('sign lists everything it is missing', () => {
  const s = setup();
  const r = run('sign', '--release', s.release, '--key', s.privateKey);
  assert.equal(r.code, 2);
  assert.match(r.err, /--release-id/);
  assert.match(r.err, /versions\.kiroCli/);
  assert.match(r.err, new RegExp(`seeds entry .*${TASK_ID}`));
});

test('sign refuses a symlink in the release', () => {
  const s = setup();
  fs.symlinkSync('/etc/hostname', path.join(s.release, 'link.txt'));
  const r = run(...signArgs(s));
  assert.equal(r.code, 1);
  assert.match(r.err, /link\.txt is a symlink/);
});

test('sign refuses a private key that others can read', () => {
  const s = setup();
  fs.chmodSync(s.privateKey, 0o644);
  assert.match(run(...signArgs(s)).err, /chmod 600/);
});

test('one changed byte fails verify', () => {
  const s = signedRelease();
  fs.appendFileSync(path.join(s.release, 'refusal-rule.json'), ' ');
  const r = run('verify', '--release', s.release, '--keys', s.keys);
  assert.equal(r.code, 1);
  assert.match(r.err, /refusal-rule\.json does not match its manifest hash/);
});

test('an unpinned key fails verify', () => {
  const s = signedRelease();
  fs.writeFileSync(s.keys, '[]\n');
  const r = run('verify', '--release', s.release, '--keys', s.keys);
  assert.equal(r.code, 1);
  assert.match(r.err, /is not pinned/);
});

test('a revoked key fails verify', () => {
  const s = signedRelease();
  const { keyId } = JSON.parse(fs.readFileSync(s.keys, 'utf8'))[0];
  assert.equal(run('revoke', '--key-id', keyId, '--keys', s.keys).code, 0);
  const r = run('verify', '--release', s.release, '--keys', s.keys);
  assert.equal(r.code, 1);
  assert.match(r.err, /is revoked/);
});

test('revoke refuses a key that is not pinned', () => {
  const s = setup();
  assert.equal(run('revoke', '--key-id', 'f'.repeat(64), '--keys', s.keys).code, 2);
});
