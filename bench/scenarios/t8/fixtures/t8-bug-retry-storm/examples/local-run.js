'use strict';

const { createHttpClient } = require('../src/shared-http-client');
const { createOrderSyncWorker } = require('../src/order-sync-worker');
const client = createHttpClient({ transport: async () => ({ status: 201, headers: {} }) });
createOrderSyncWorker({ client }).syncOrder({ id: 'local-example' }).then(console.log);
