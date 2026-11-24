'use strict';

const { createQueue, enqueue, drain } = require('../src');

(async () => {
  const queue = createQueue({ concurrency: 2, baseDelayMs: 0, jitter: false });
  for (let i = 0; i < 10; i += 1) enqueue(queue, () => i);
  await drain(queue);
  console.log('benchmark sample complete');
})();
