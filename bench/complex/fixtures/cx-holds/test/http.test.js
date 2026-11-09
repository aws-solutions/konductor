'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { createStock, createServer, systemClock } = require('../src');

async function withServer(fn) {
  const server = createServer({ stock: createStock({ widget: 5 }), clock: systemClock });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  try {
    return await fn(`http://127.0.0.1:${server.address().port}`);
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
}

test('GET /stock/:sku reports availability', async () => {
  await withServer(async (base) => {
    const res = await fetch(`${base}/stock/widget`);
    assert.equal(res.status, 200);
    assert.deepEqual(await res.json(), { sku: 'widget', available: 5 });
  });
});

test('an unknown sku answers 404 with the error shape', async () => {
  await withServer(async (base) => {
    const res = await fetch(`${base}/stock/nothing`);
    assert.equal(res.status, 404);
    assert.equal((await res.json()).error.code, 'unknown_sku');
  });
});
