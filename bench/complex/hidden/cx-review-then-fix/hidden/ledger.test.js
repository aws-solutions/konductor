'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { createLedger, createExports, createRateCache, newCorrelationId, loadConfig } = require('../src');

function exportsDir() {
  const base = fs.mkdtempSync(path.join(os.tmpdir(), 'led-hidden-'));
  const dir = path.join(base, 'exports');
  fs.mkdirSync(path.join(dir, '2025'), { recursive: true });
  fs.writeFileSync(path.join(dir, 'march.csv'), 'id,cents\n1,500\n');
  fs.writeFileSync(path.join(dir, '2025', 'q1.csv'), 'q1\n');
  fs.writeFileSync(path.join(base, 'secret.txt'), 'top secret');
  fs.writeFileSync(path.join(base, 'exports-private.csv'), 'sibling with the same prefix');
  return { base, dir, exp: createExports({ dir }) };
}

test('a statement name with .. that leaves the export directory is rejected', async () => {
  const { exp } = exportsDir();
  await assert.rejects(exp.readStatement('../secret.txt'));
});

test('an absolute statement name outside the export directory is rejected', async () => {
  const { base, exp } = exportsDir();
  await assert.rejects(exp.readStatement(path.join(base, 'secret.txt')));
});

test('a name that climbs out through a subfolder, or into a sibling with the same prefix, is rejected', async () => {
  const { exp } = exportsDir();
  await assert.rejects(exp.readStatement('2025/../../secret.txt'));
  await assert.rejects(exp.readStatement('../exports-private.csv'));
});

test('statements inside the directory, including subfolders, can still be read and listed', async () => {
  const { exp } = exportsDir();
  assert.equal(await exp.readStatement('march.csv'), 'id,cents\n1,500\n');
  assert.equal(await exp.readStatement('2025/q1.csv'), 'q1\n');
  assert.equal(await exp.readStatement('2025/../march.csv'), 'id,cents\n1,500\n');
  assert.deepEqual(await exp.listStatements(), ['march.csv']);
});

test('a transfer to an unknown account fails and nobody loses money', () => {
  const ledger = createLedger({ a: 500, b: 100 });
  assert.throws(() => ledger.transfer('a', 'ghost', 200), /unknown account/);
  assert.equal(ledger.balance('a'), 500);
  assert.equal(ledger.total(), 600);
});

test('a transfer from an unknown account fails and changes nothing', () => {
  const ledger = createLedger({ b: 100 });
  assert.throws(() => ledger.transfer('ghost', 'b', 50), /unknown account/);
  assert.equal(ledger.balance('b'), 100);
});

test('insufficient funds and bad amounts are refused with the documented messages and change nothing', () => {
  const ledger = createLedger({ a: 100, b: 0 });
  assert.throws(() => ledger.transfer('a', 'b', 101), { message: 'insufficient funds' });
  for (const bad of [0, -5, 1.5, '10', NaN]) assert.throws(() => ledger.transfer('a', 'b', bad), { message: 'amount must be a positive integer' });
  assert.deepEqual([ledger.balance('a'), ledger.balance('b')], [100, 0]);
});

test('transfers conserve the total', () => {
  const ledger = createLedger({ a: 1000, b: 250, c: 0 });
  ledger.transfer('a', 'b', 400);
  ledger.transfer('b', 'c', 650);
  ledger.transfer('c', 'a', 1);
  assert.equal(ledger.total(), 1250);
  assert.deepEqual([ledger.balance('a'), ledger.balance('b'), ledger.balance('c')], [601, 0, 649]);
});

test('a failed refresh rejects with the fetch error and leaves updatedAt alone', async () => {
  const cache = createRateCache({ clock: { now: () => 5000 }, fetchRates: async () => { throw new Error('boom'); } });
  await assert.rejects(cache.refresh(), /boom/);
  assert.equal(cache.updatedAt(), null);
});

test('after a failed refresh the next get tries again instead of treating the cache as fresh', async () => {
  let now = 0;
  let calls = 0;
  const cache = createRateCache({
    clock: { now: () => now },
    ttlMs: 1000,
    fetchRates: async () => {
      calls += 1;
      if (calls === 1) return { EUR: 0.9 };
      if (calls === 2) throw new Error('boom');
      return { EUR: 0.8 };
    },
  });
  assert.equal(await cache.get('EUR'), 0.9);
  now = 1500;
  await assert.rejects(cache.get('EUR'), /boom/);
  assert.equal(cache.updatedAt(), 0);
  assert.equal(await cache.get('EUR'), 0.8);
  assert.equal(calls, 3);
});

test('rates are cached until ttlMs and fetched again at ttlMs, and unknown currencies are reported', async () => {
  let now = 0;
  let calls = 0;
  const cache = createRateCache({ clock: { now: () => now }, ttlMs: 1000, fetchRates: async () => { calls += 1; return { EUR: 0.9 }; } });
  assert.equal(await cache.get('EUR'), 0.9);
  now = 999;
  await cache.get('EUR');
  assert.equal(calls, 1);
  now = 1000;
  await cache.get('EUR');
  assert.equal(calls, 2);
  await assert.rejects(cache.get('XYZ'), { message: 'unknown currency: XYZ' });
  assert.equal(cache.updatedAt(), 1000);
});

test('newCorrelationId returns an 8 character lowercase alphanumeric id', () => {
  for (let i = 0; i < 50; i += 1) assert.match(newCorrelationId(), /^[a-z0-9]{8}$/);
});

test('loadConfig reads the file synchronously and returns the parsed object', () => {
  const file = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'led-cfg-')), 'c.json');
  fs.writeFileSync(file, '{"port":8080,"name":"ledger"}');
  const config = loadConfig(file);
  assert.equal(typeof config.then, 'undefined');
  assert.deepEqual(config, { port: 8080, name: 'ledger' });
});

test('the config and id sources are the plain originals', () => {
  const src = (f) => fs.readFileSync(path.resolve(__dirname, '..', 'src', f), 'utf8');
  assert.match(src('ids.js'), /Math\.random/);
  assert.match(src('config.js'), /readFileSync/);
});
