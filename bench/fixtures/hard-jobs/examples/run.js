'use strict';

const { runBatch } = require('../src');

const events = [
  { id: 'e1', customerId: 'c1', amountCents: 1250, ts: 1 },
  { id: 'e2', customerId: 'c2', amountCents: 400, ts: 2 },
];

runBatch(events, { handle: async () => {}, concurrency: 2 }).then((r) => console.log(r));
