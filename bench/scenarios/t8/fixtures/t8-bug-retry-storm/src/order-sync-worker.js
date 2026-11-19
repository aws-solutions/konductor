'use strict';

const { createHttpClient } = require('./shared-http-client');

function createOrderSyncWorker({ client, logger = console, endpoint = 'https://partner.internal/orders' } = {}) {
  if (!client || typeof client.request !== 'function') throw new TypeError('client is required');

  async function syncOrder(order) {
    if (!order || typeof order.id !== 'string') throw new TypeError('order.id is required');
    const request = {
      method: 'POST',
      url: endpoint,
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(order)
    };
    const response = await client.request(request);
    if (response.status < 200 || response.status >= 300) {
      logger.warn?.('order sync returned non-success', { orderId: order.id, status: response.status });
      return { ok: false, orderId: order.id, status: response.status };
    }
    logger.info?.('order synced', { orderId: order.id, status: response.status });
    return { ok: true, orderId: order.id, status: response.status };
  }

  return { syncOrder };
}

async function main() {
  const transport = async (request) => ({ status: 200, headers: {}, body: request.body });
  const client = createHttpClient({ transport });
  const worker = createOrderSyncWorker({ client });
  await worker.syncOrder({ id: 'sample-1', totalCents: 1200 });
}

if (require.main === module) main().catch((error) => { console.error(error); process.exitCode = 1; });

module.exports = { createOrderSyncWorker };
