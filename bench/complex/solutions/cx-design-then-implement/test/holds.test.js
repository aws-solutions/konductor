'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { createStock, createHoldService } = require('../src');

function setup(levels = { widget: 3 }) {
  let now = 1_000_000;
  const clock = { now: () => now };
  const stock = createStock(levels);
  return { svc: createHoldService({ stock, clock }), stock, advance: (ms) => { now += ms; } };
}

test('a hold takes units out of availability', async () => {
  const { svc } = setup();
  const hold = await svc.hold('widget', 2, 60);
  assert.equal(hold.status, 'active');
  assert.equal(hold.expiresAt, 1_000_000 + 60_000);
  assert.equal(await svc.available('widget'), 1);
});

test('a hold for more than is available fails and changes nothing', async () => {
  const { svc } = setup();
  await assert.rejects(svc.hold('widget', 4, 60), { code: 'insufficient_stock' });
  assert.equal(await svc.available('widget'), 3);
});

test('release returns the units once', async () => {
  const { svc } = setup();
  const hold = await svc.hold('widget', 2, 60);
  await Promise.all([svc.release(hold.id), svc.release(hold.id)]);
  assert.equal(await svc.available('widget'), 3);
});

test('an expired hold returns its units and cannot be confirmed', async () => {
  const { svc, advance } = setup();
  const hold = await svc.hold('widget', 2, 60);
  advance(60_000);
  await assert.rejects(svc.confirm(hold.id), { code: 'hold_expired' });
  assert.equal(await svc.available('widget'), 3);
});

test('two buyers racing for the last unit: one wins', async () => {
  const { svc } = setup({ widget: 1 });
  const results = await Promise.allSettled([svc.hold('widget', 1, 60), svc.hold('widget', 1, 60)]);
  assert.equal(results.filter((r) => r.status === 'fulfilled').length, 1);
  assert.equal(await svc.available('widget'), 0);
});
