// SPDX-License-Identifier: Apache-2.0
// One spend rule: an unknown cost never counts as 0, and the paid keep-or-prune call checks the ledger under a lock
// and gives kiro-cli only the runner's env allowlist. No model, no network, no spend.
'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { spawn } = require('node:child_process');
const { tmp, write } = require('./helpers.js');
const { openLedger, readLedger, UNKNOWN_FLOOR } = require('../lib/credit-ledger.js');
const { paidCall, ledgerSpent } = require('../../cap/paidcall.js');
const { withFileLock } = require('../lib/file-lock.js');

const FAKE = path.join(__dirname, 'fake-kp-kiro.js');

test('an unknown cost counts at the larger of 15 and the highest cost seen, never 0', () => {
  const dir = tmp();
  try {
    const l = openLedger({ dir, budget: 100 });
    l.record({ kind: 'run', credits: null });
    assert.equal(l.totals().session, UNKNOWN_FLOOR);
    l.record({ kind: 'run', credits: 40 });
    l.record({ kind: 'judge', credits: null });
    assert.equal(l.totals().session, 15 + 40 + 40);
    assert.equal(l.totals().unknown, 2);
    assert.equal(l.state(), 'stop', '95 of 100 is past the 90% soft stop');
    assert.equal(readLedger(dir).totals.total, 95, 'a re-read counts the same');
    l.record({ kind: 'judge', unit: 'usd', credits: 0, usd: 0.01 });
    assert.equal(l.totals().session, 95, 'a USD line adds no credits');
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

/** A paid-call rig on the fake kiro-cli. */
function rig() {
  const root = tmp();
  const authDb = path.join(root, 'auth.sqlite3');
  write(authDb, 'fake');
  return { root, paid: { cap: 1000, ledger: path.join(root, 'ledger.jsonl'), workDir: path.join(root, 'work'), bin: FAKE, authDb } };
}

test('a paid kiro-cli call gets the env allowlist, not the host env', () => {
  const r = rig();
  const envFile = path.join(r.root, 'env.json');
  const keep = process.env.BENCH_PAID_ENV_KEEP;
  process.env.BENCH_PAID_ENV_KEEP = 'FAKE_KP_ENV_OUT';
  process.env.FAKE_KP_ENV_OUT = envFile;
  process.env.AWS_SECRET_ACCESS_KEY = 'host-secret';
  try {
    paidCall({ ...r.paid, model: 'glm-5', prompt: 'hello', out: path.join(r.root, 'out', 'a') });
    const seen = JSON.parse(fs.readFileSync(envFile, 'utf8'));
    assert.equal(seen.AWS_SECRET_ACCESS_KEY, undefined, 'a host credential never reaches the call');
    assert.ok(seen.HOME.startsWith(r.paid.workDir));
    assert.ok(seen.PATH);
  } finally {
    delete process.env.AWS_SECRET_ACCESS_KEY;
    delete process.env.FAKE_KP_ENV_OUT;
    if (keep === undefined) delete process.env.BENCH_PAID_ENV_KEEP; else process.env.BENCH_PAID_ENV_KEEP = keep;
    fs.rmSync(r.root, { recursive: true, force: true });
  }
});

test('BENCH_PAID_ENV_KEEP refuses a name that looks like a credential', () => {
  const r = rig();
  const keep = process.env.BENCH_PAID_ENV_KEEP;
  process.env.BENCH_PAID_ENV_KEEP = 'AWS_SECRET_ACCESS_KEY';
  try {
    assert.throws(() => paidCall({ ...r.paid, model: 'glm-5', prompt: 'hello', out: path.join(r.root, 'out', 'a') }), /looks like a credential/);
    assert.equal(ledgerSpent(r.paid.ledger), 0, 'refused before any reservation');
  } finally {
    if (keep === undefined) delete process.env.BENCH_PAID_ENV_KEEP; else process.env.BENCH_PAID_ENV_KEEP = keep;
    fs.rmSync(r.root, { recursive: true, force: true });
  }
});

/** Spawns one paid caller per index under a 20-credit cap; resolves to what each printed. */
function callers(r, indexes) {
  const script = path.join(r.root, 'caller.js');
  write(script, `const { paidCall } = require(${JSON.stringify(path.join(__dirname, '..', '..', 'cap', 'paidcall.js'))});
try { paidCall({ ...${JSON.stringify(r.paid)}, cap: 20, model: 'glm-5', prompt: 'p' + process.argv[2], out: process.argv[3] }); console.log('called'); }
catch (e) { console.log(e.constructor.name); }\n`);
  return indexes.map((i) => new Promise((res) => {
    const c = spawn(process.execPath, [script, String(i), path.join(r.root, 'out', `c${i}`)]);
    let out = '';
    c.stdout.on('data', (d) => { out += d; });
    c.on('close', () => res(out.trim()));
  }));
}

test('a paid caller waits for the ledger lock and reads the spend written under it', async () => {
  const r = rig();
  try {
    fs.mkdirSync(path.dirname(r.paid.ledger), { recursive: true });
    const pending = callers(r, [1, 2]);
    withFileLock(`${r.paid.ledger}.lock`, () => {
      Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 1500);
      fs.appendFileSync(r.paid.ledger, `${JSON.stringify({ label: 'other', counted: 15, reserved: true })}\n`);
    });
    const outs = await Promise.all(pending);
    assert.deepEqual(outs, ['PaidCallRefused', 'PaidCallRefused'], 'both saw the 15 written while they waited');
  } finally { fs.rmSync(r.root, { recursive: true, force: true }); }
});

test('two paid callers racing on one ledger never both pass the cap', async () => {
  const r = rig();
  try {
    // Three processes each try one call under a 20-credit cap: only one 15-credit reservation fits.
    const outs = await Promise.all(callers(r, [1, 2, 3]));
    assert.equal(outs.filter((o) => o === 'called').length, 1, outs.join(' | '));
    assert.equal(outs.filter((o) => o === 'PaidCallRefused').length, 2, outs.join(' | '));
    assert.equal(ledgerSpent(r.paid.ledger), 15);
  } finally { fs.rmSync(r.root, { recursive: true, force: true }); }
});

test('withFileLock takes over a lock left by a dead process', () => {
  const dir = tmp();
  try {
    const lock = path.join(dir, 'x.lock');
    fs.writeFileSync(lock, '999999999\n');
    assert.equal(withFileLock(lock, () => 'ran', { timeoutMs: 2000 }), 'ran');
    assert.equal(fs.existsSync(lock), false);
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});
