import test from 'node:test';
import assert from 'node:assert/strict';
import { makeApp } from '../src/app.js';
import { MemoryStore } from '../src/store/memory-store.js';
import { CatalogStore } from '../src/store/catalog-store.js';
import { AuditLog } from '../src/events/audit-log.js';
import { SyncEmitter } from '../src/events/sync-emitter.js';
import { loadConfig } from '../src/config.js';

function appWithStock(quantity = 5, holdMinutes = 15) {
  const config = loadConfig();
  config.limits.reservation.holdMinutes = holdMinutes;
  return makeApp({
    config,
    store: new MemoryStore([{ warehouseId: 'north', sku: 'BEANS-1KG', quantity }]),
    catalog: new CatalogStore([{ sku: 'BEANS-1KG', sellable: true }]),
    events: new SyncEmitter(),
    audit: new AuditLog(),
    logger: { warn() {}, error() {} },
  });
}

const sleep = (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds));

test('reservation reduces available stock and records a hold', async () => {
  const app = appWithStock(5);
  const hold = await app.inventory.reserve('north', 'BEANS-1KG', 2, 'checkout-1');
  assert.equal(hold.quantity, 2);
  assert.equal(await app.store.getStock('north', 'BEANS-1KG'), 3);
  assert.equal((await app.store.getReservation(hold.id)).sku, 'BEANS-1KG');
});

test('reservation rejects more units than are available', async () => {
  const app = appWithStock(2);
  await assert.rejects(() => app.inventory.reserve('north', 'BEANS-1KG', 3), /insufficient/);
});

test('release restores the held units', async () => {
  const app = appWithStock(5);
  const hold = await app.inventory.reserve('north', 'BEANS-1KG', 2);
  const result = await app.inventory.release(hold.id, 'checkout-1');
  assert.deepEqual(result, { released: true, id: hold.id });
  assert.equal(await app.store.getStock('north', 'BEANS-1KG'), 5);
  assert.equal(await app.store.getReservation(hold.id), null);
});

test('router accepts a reservation request', async () => {
  const app = appWithStock(4);
  const response = await app.router({
    method: 'POST',
    path: '/reservations',
    headers: { 'x-request-id': 'checkout-9' },
    body: JSON.stringify({ warehouseId: 'north', sku: 'BEANS-1KG', quantity: 1 }),
  });
  assert.equal(response.status, 201);
  assert.equal(response.body.requestId, 'checkout-9');
});

test('expired holds are released by the sweep', async () => {
  const app = appWithStock(5, 0.0001);
  const hold = await app.inventory.reserve('north', 'BEANS-1KG', 2);
  await sleep(15);
  assert.equal(await app.inventory.sweepExpired(), 1);
  assert.equal(await app.store.getReservation(hold.id), null);
  assert.equal(await app.store.getStock('north', 'BEANS-1KG'), 5);
});

test('sweep leaves a current hold alone', async () => {
  const app = appWithStock(5, 15);
  await app.inventory.reserve('north', 'BEANS-1KG', 1);
  assert.equal((await app.store.listReservations()).length, 1);
  assert.match((await app.store.listReservations())[0].expiresAt, /Z$/);
});
