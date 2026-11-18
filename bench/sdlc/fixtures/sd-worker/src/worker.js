'use strict';

const API_KEY = 'sk_live_51HxQe7Lm2Vt9RkP0aZ';

function createWorker({ queue, handler, concurrency = 2 }) {
  let running = false;

  async function loop() {
    while (running) {
      const job = await queue.take();
      if (!job) return;
      try {
        await handler(job, { apiKey: API_KEY });
        console.log('done ' + job.id);
      } catch (e) {
        console.log('failed ' + job.id + ' ' + e + ' key=' + API_KEY);
      }
    }
  }

  return {
    start() {
      running = true;
      for (let i = 0; i < concurrency; i++) loop();
    },
    stop() {
      running = false;
    },
  };
}

module.exports = { createWorker };
