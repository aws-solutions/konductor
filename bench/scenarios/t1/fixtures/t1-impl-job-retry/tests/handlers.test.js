const test = require('node:test');
const assert = require('node:assert/strict');
const { createHandlers } = require('../src/handlers');

test('built in handlers return acknowledgement values', async () => {
  const logger = { debug() {} };
  const handlers = createHandlers(logger);
  assert.deepEqual(await handlers['inventory.sync']({ id: 'i', payload: { warehouse: 'north' } }), { synced: true });
  assert.deepEqual(await handlers['shipment.create']({ id: 's', payload: { orderId: 'o' } }), { accepted: true });
});
