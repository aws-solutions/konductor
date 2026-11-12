// SPDX-License-Identifier: Apache-2.0
'use strict';

// The login check runs `kiro-cli whoami` in a scratch HOME. These tests stub the command: the real CLI is never called.

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { tmp } = require('./helpers.js');
const { checkKiroLogin, makeLoginCheck } = require('../lib/login-check.js');

function setup() {
  const root = tmp();
  const authDb = path.join(root, 'data.sqlite3');
  fs.writeFileSync(authDb, 'fake-auth');
  const scratchDir = path.join(root, 'scratch');
  fs.mkdirSync(scratchDir);
  return { root, authDb, scratchDir };
}

const check = (s, run) => checkKiroLogin({ kiroBin: '/not/a/real/kiro-cli', authDb: s.authDb, scratchDir: s.scratchDir, envKeep: [], agentEngine: 'v2', run });

test('exit 0 is a valid login; the command gets the scratch HOME with the auth copy and leaves no directory behind', async () => {
  const s = setup();
  try {
    let seen;
    const res = await check(s, async (bin, env) => { seen = { bin, home: env.HOME, copied: fs.readdirSync(env.HOME).length > 0 }; return { error: null, output: 'Logged in\n' }; });
    assert.deepEqual(res, { ok: true });
    assert.equal(seen.bin, '/not/a/real/kiro-cli');
    assert.ok(seen.home.startsWith(s.scratchDir));
    assert.ok(seen.copied);
    assert.deepEqual(fs.readdirSync(s.scratchDir), []);
  } finally { fs.rmSync(s.root, { recursive: true, force: true }); }
});

test('a non-zero exit, or a login message in the output, is a failed check with the message as detail', async () => {
  const s = setup();
  try {
    const failed = await check(s, async () => ({ error: Object.assign(new Error('x'), { code: 1 }), output: '\nError: Not logged in\n' }));
    assert.deepEqual(failed, { ok: false, detail: 'Error: Not logged in' });
    const quiet = await check(s, async () => ({ error: null, output: 'token already expired' }));
    assert.equal(quiet.ok, false);
    const plain = await check(s, async () => ({ error: Object.assign(new Error('x'), { code: 3 }), output: 'something broke\n' }));
    assert.deepEqual(plain, { ok: false, detail: 'something broke' });
  } finally { fs.rmSync(s.root, { recursive: true, force: true }); }
});

test('a CLI without whoami, a timeout or a spawn problem is unavailable, not a login failure', async () => {
  const s = setup();
  try {
    const none = await check(s, async () => ({ error: Object.assign(new Error('x'), { code: 2 }), output: "error: unrecognized subcommand 'whoami'" }));
    assert.equal(none.ok, true);
    assert.match(none.unavailable, /no whoami/);
    const slow = await check(s, async () => ({ error: Object.assign(new Error('x'), { code: null, signal: 'SIGTERM' }), output: '' }));
    assert.equal(slow.ok, true);
    assert.match(slow.unavailable, /did not finish/);
    const gone = await check(s, async () => ({ error: Object.assign(new Error('x'), { code: 'ENOENT' }), output: '' }));
    assert.equal(gone.ok, true);
    const noDb = await checkKiroLogin({ kiroBin: 'x', authDb: path.join(s.root, 'missing.db'), scratchDir: s.scratchDir, run: async () => { throw new Error('must not run'); } });
    assert.equal(noDb.ok, true);
    assert.match(noDb.unavailable, /could not run/);
  } finally { fs.rmSync(s.root, { recursive: true, force: true }); }
});

test('only kiro-cli runs get a check; the check is replaceable', async () => {
  const args = { kiroBin: '/k', authDb: '/a', scratchDir: '/s', envKeep: ['X'], agentEngine: 'v3' };
  assert.equal(makeLoginCheck({ ...args, isUsd: true }), null);
  let got;
  const fn = makeLoginCheck({ ...args, isUsd: false, check: async (a) => { got = a; return { ok: true }; } });
  assert.deepEqual(await fn(), { ok: true });
  assert.deepEqual(got, args);
});
