'use strict';

const { createQueue, enqueue, drain } = require('../src');
const queue = createQueue({ baseDelayMs: 0, jitter: false });
enqueue(queue, () => console.log('example job'));
drain(queue).then(() => console.log('example complete'));
