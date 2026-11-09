'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { createLedger, createExports, createRateCache } = require('../src');

test('a transfer to an unknown account leaves the source balance alone', () => {
  const ledger = createLedger({ a: 500 });
  assert.throws(() => ledger.transfer('a', 'ghost', 100), /unknown account: ghost/);
  assert.equal(ledger.balance('a'), 500);
  assert.equal(ledger.total(), 500);
});

test('a statement name that points outside the export directory is rejected', async () => {
  const base = fs.mkdtempSync(path.join(os.tmpdir(), 'exp-'));
  const dir = path.join(base, 'exports');
  fs.mkdirSync(dir);
  fs.writeFileSync(path.join(base, 'secret.txt'), 'top secret');
  const exp = createExports({ dir });
  await assert.rejects(exp.readStatement('../secret.txt'));
  await assert.rejects(exp.readStatement(path.join(base, 'secret.txt')));
});

test('a failed refresh rejects and does not count as fresh', async () => {
  let now = 0;
  let fail = true;
  const cache = createRateCache({ clock: { now: () => now }, ttlMs: 1000, fetchRates: async () => { if (fail) throw new Error('boom'); return { EUR: 0.9 }; } });
  await assert.rejects(cache.get('EUR'), /boom/);
  assert.equal(cache.updatedAt(), null);
  fail = false;
  assert.equal(await cache.get('EUR'), 0.9);
});
