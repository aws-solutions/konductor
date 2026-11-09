'use strict';

const { createRoutedServer } = require('./http');

function createServer({ stock }) {
  return createRoutedServer([
    {
      method: 'GET',
      path: '/stock/:sku',
      handler: async ({ params }) => ({ body: { sku: params.sku, available: await stock.quantity(params.sku) } }),
    },
  ]);
}

module.exports = { createServer };
