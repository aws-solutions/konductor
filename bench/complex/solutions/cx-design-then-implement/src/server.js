'use strict';

const { createRoutedServer } = require('./http');
const { createHoldService } = require('./holds');

function createServer({ stock, clock }) {
  const holds = createHoldService({ stock, clock });
  return createRoutedServer([
    {
      method: 'GET',
      path: '/stock/:sku',
      handler: async ({ params }) => ({ body: { sku: params.sku, available: await holds.available(params.sku) } }),
    },
    {
      method: 'POST',
      path: '/holds',
      handler: async ({ body }) => ({ status: 201, body: await holds.hold(body.sku, body.qty, body.ttlSec) }),
    },
    {
      method: 'POST',
      path: '/holds/:id/confirm',
      handler: async ({ params }) => ({ body: await holds.confirm(params.id) }),
    },
    {
      method: 'DELETE',
      path: '/holds/:id',
      handler: async ({ params }) => ({ body: await holds.release(params.id) }),
    },
  ]);
}

module.exports = { createServer };
