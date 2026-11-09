'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { createStock, createHoldService, createServer } = require('../src');

const T0 = 1_700_000_000_000;

function setup(levels = { widget: 5, gadget: 2 }) {
  let now = T0;
  const clock = { now: () => now };
  const stock = createStock(levels);
  return {
    clock,
    stock,
    svc: createHoldService({ stock, clock }),
    advance: (ms) => { now += ms; },
  };
}

async function withServer(levels, fn) {
  const s = setup(levels);
  const server = createServer({ stock: s.stock, clock: s.clock });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const base = `http://127.0.0.1:${server.address().port}`;
  const call = async (method, path, body) => {
    const res = await fetch(base + path, { method, body: body === undefined ? undefined : typeof body === 'string' ? body : JSON.stringify(body) });
    return { status: res.status, body: await res.json() };
  };
  try {
    return await fn({ ...s, call });
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
}

test('a hold reports its fields, expires ttlSec seconds out and takes units out of availability', async () => {
  const { svc } = setup();
  const hold = await svc.hold('widget', 2, 60);
  assert.equal(typeof hold.id, 'string');
  assert.equal(hold.sku, 'widget');
  assert.equal(hold.qty, 2);
  assert.equal(hold.status, 'active');
  assert.equal(hold.expiresAt, T0 + 60_000);
  assert.equal(await svc.available('widget'), 3);
  const other = await svc.hold('widget', 1, 60);
  assert.notEqual(other.id, hold.id);
});

test('ttlSec defaults to 300 seconds', async () => {
  const { svc } = setup();
  const hold = await svc.hold('widget', 1);
  assert.equal(hold.expiresAt, T0 + 300_000);
});

test('malformed input is rejected with invalid_request and holds nothing', async () => {
  const { svc } = setup();
  for (const [sku, qty, ttl] of [['widget', 0, 60], ['widget', -1, 60], ['widget', 1.5, 60], ['widget', '2', 60], ['', 1, 60], ['widget', 1, 0], ['widget', 1, 901], ['widget', 1, 2.5]]) {
    await assert.rejects(svc.hold(sku, qty, ttl), { code: 'invalid_request' }, JSON.stringify([sku, qty, ttl]));
  }
  assert.equal(await svc.available('widget'), 5);
});

test('unknown sku and too few units fail without changing availability', async () => {
  const { svc } = setup();
  await assert.rejects(svc.hold('nothing', 1, 60), { code: 'unknown_sku' });
  await assert.rejects(svc.hold('gadget', 3, 60), { code: 'insufficient_stock' });
  assert.equal(await svc.available('gadget'), 2);
});

test('confirm sells the units for good, is repeatable and survives the expiry time', async () => {
  const { svc, advance } = setup();
  const hold = await svc.hold('widget', 2, 60);
  assert.equal((await svc.confirm(hold.id)).status, 'confirmed');
  assert.equal((await svc.confirm(hold.id)).status, 'confirmed');
  advance(10 * 60_000);
  assert.equal(await svc.available('widget'), 3);
  await assert.rejects(svc.release(hold.id), { code: 'hold_confirmed' });
  await assert.rejects(svc.confirm('no-such-hold'), { code: 'hold_not_found' });
});

test('release returns the units, a second release changes nothing and a released hold cannot be confirmed', async () => {
  const { svc } = setup();
  const hold = await svc.hold('widget', 4, 60);
  assert.equal((await svc.release(hold.id)).status, 'released');
  assert.equal((await svc.release(hold.id)).status, 'released');
  assert.equal(await svc.available('widget'), 5);
  await assert.rejects(svc.confirm(hold.id), { code: 'hold_released' });
});

test('an expired hold gives its units back without any background work', async () => {
  const { svc, advance } = setup();
  await svc.hold('widget', 5, 30);
  await assert.rejects(svc.hold('widget', 1, 30), { code: 'insufficient_stock' });
  advance(30_000);
  assert.equal(await svc.available('widget'), 5);
  const again = await svc.hold('widget', 5, 30);
  assert.equal(again.status, 'active');
});

test('a hold is still active the instant before expiresAt and expired at expiresAt', async () => {
  const { svc, advance } = setup();
  const a = await svc.hold('widget', 1, 10);
  advance(9_999);
  assert.equal((await svc.confirm(a.id)).status, 'confirmed');
  const b = await svc.hold('widget', 1, 10);
  advance(10_000);
  await assert.rejects(svc.confirm(b.id), { code: 'hold_expired' });
  assert.equal(await svc.available('widget'), 4);
  assert.equal((await svc.release(b.id)).status, 'expired');
});

test('two buyers racing for the last unit: exactly one gets it and stock never goes negative', async () => {
  const { svc } = setup({ widget: 1 });
  const results = await Promise.allSettled([svc.hold('widget', 1, 60), svc.hold('widget', 1, 60), svc.hold('widget', 1, 60)]);
  assert.equal(results.filter((r) => r.status === 'fulfilled').length, 1);
  for (const r of results.filter((x) => x.status === 'rejected')) assert.equal(r.reason.code, 'insufficient_stock');
  assert.equal(await svc.available('widget'), 0);
});

test('overlapping releases, and reads after expiry, hand units back exactly once', async () => {
  const s = setup();
  const hold = await s.svc.hold('widget', 3, 60);
  await Promise.all([s.svc.release(hold.id), s.svc.release(hold.id), s.svc.release(hold.id)]);
  assert.equal(await s.svc.available('widget'), 5);

  await s.svc.hold('gadget', 2, 10);
  s.advance(10_000);
  const reads = await Promise.all([s.svc.available('gadget'), s.svc.available('gadget'), s.svc.available('gadget')]);
  assert.deepEqual(reads, [2, 2, 2]);
  assert.equal(await s.stock.quantity('gadget'), 2);
});

test('HTTP: create answers 201, confirm and delete answer 200, and stock follows', async () => {
  await withServer({ widget: 5 }, async ({ call }) => {
    const created = await call('POST', '/holds', { sku: 'widget', qty: 2, ttlSec: 60 });
    assert.equal(created.status, 201);
    assert.equal(created.body.status, 'active');
    assert.equal(created.body.expiresAt, T0 + 60_000);
    assert.deepEqual((await call('GET', '/stock/widget')).body, { sku: 'widget', available: 3 });

    const confirmed = await call('POST', `/holds/${created.body.id}/confirm`);
    assert.equal(confirmed.status, 200);
    assert.equal(confirmed.body.status, 'confirmed');

    const second = await call('POST', '/holds', { sku: 'widget', qty: 3 });
    const released = await call('DELETE', `/holds/${second.body.id}`);
    assert.equal(released.status, 200);
    assert.equal(released.body.status, 'released');
    assert.equal((await call('GET', '/stock/widget')).body.available, 3);
  });
});

test('HTTP: errors carry the documented status and code, and expiry shows in GET /stock', async () => {
  await withServer({ widget: 2 }, async ({ call, advance }) => {
    assert.deepEqual(await call('POST', '/holds', { sku: 'widget', qty: 0 }).then((r) => [r.status, r.body.error.code]), [400, 'invalid_request']);
    assert.deepEqual(await call('POST', '/holds', '{not json').then((r) => [r.status, r.body.error.code]), [400, 'invalid_request']);
    assert.deepEqual(await call('POST', '/holds', { sku: 'nothing', qty: 1 }).then((r) => [r.status, r.body.error.code]), [404, 'unknown_sku']);
    assert.deepEqual(await call('POST', '/holds', { sku: 'widget', qty: 3 }).then((r) => [r.status, r.body.error.code]), [409, 'insufficient_stock']);
    assert.deepEqual(await call('POST', '/holds/missing/confirm').then((r) => [r.status, r.body.error.code]), [404, 'hold_not_found']);

    const hold = await call('POST', '/holds', { sku: 'widget', qty: 2, ttlSec: 5 });
    assert.equal((await call('GET', '/stock/widget')).body.available, 0);
    advance(5_000);
    assert.equal((await call('GET', '/stock/widget')).body.available, 2);
    assert.deepEqual(await call('POST', `/holds/${hold.body.id}/confirm`).then((r) => [r.status, r.body.error.code]), [410, 'hold_expired']);
  });
});
