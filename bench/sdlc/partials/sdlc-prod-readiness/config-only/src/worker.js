'use strict';

const { loadConfig } = require('./config');

function createWorker({ queue, handler, env = process.env }) {
  const config = loadConfig(env);
  let running = false;

  async function loop() {
    while (running) {
      const job = await queue.take();
      if (!job) return;
      try {
        await handler(job, { apiKey: config.apiKey });
        console.log('done ' + job.id);
      } catch (e) {
        console.log('failed ' + job.id + ' ' + e);
      }
    }
  }

  return {
    start() {
      running = true;
      for (let i = 0; i < config.concurrency; i++) loop();
    },
    stop() {
      running = false;
    },
  };
}

module.exports = { createWorker };
