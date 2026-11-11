// SPDX-License-Identifier: Apache-2.0
// Runs a slow-path check in a worker thread, so a rule that takes too long fails its test instead of hanging the runner.
'use strict';

const { Worker } = require('worker_threads');

/**
 * Runs `body` (the source of a function body, which may use `require` with absolute paths) in a worker thread. Resolves
 * with the milliseconds it took. Rejects when it throws, or when it is still running after `limitMs`; the worker is
 * then stopped.
 */
function timeInWorker(body, limitMs = 10000) {
  const worker = new Worker(
    `const { parentPort } = require('worker_threads');
const started = Date.now();
(function () {
${body}
})();
parentPort.postMessage(Date.now() - started);`,
    { eval: true },
  );
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      worker.terminate();
      reject(new Error(`still running after ${limitMs} ms`));
    }, limitMs);
    worker.once('message', (elapsedMs) => {
      clearTimeout(timer);
      worker.terminate();
      resolve(elapsedMs);
    });
    worker.once('error', (error) => {
      clearTimeout(timer);
      reject(error);
    });
  });
}

module.exports = { timeInWorker };
