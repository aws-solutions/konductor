'use strict';

const { once } = require('./util');

/**
 * Retries an async operation with configurable attempts.
 * @param {Function} operation - Error-first callback operation to retry
 * @param {Object} options - Retry options
 * @param {number} options.retries - Number of additional attempts (default: 0)
 * @param {number} options.delayMs - Delay between retries in ms (default: 0)
 * @param {Function} callback - Optional error-first callback
 * @returns {Promise} Resolves when operation succeeds, rejects after all retries fail
 */
function retry(operation, options, callback) {
  // Handle optional options parameter
  if (typeof options === 'function') {
    callback = options;
    options = {};
  }
  
  const settings = options || {};
  const retries = Number.isInteger(settings.retries) && settings.retries >= 0 ? settings.retries : 0;
  const delayMs = Number.isInteger(settings.delayMs) && settings.delayMs > 0 ? settings.delayMs : 0;
  
  const promise = new Promise((resolve, reject) => {
    let attempt = 0;
    
    function run() {
      attempt += 1;
      operation((err, value) => {
        if (!err) {
          resolve(value);
          return;
        }
        if (attempt > retries) {
          reject(err);
          return;
        }
        if (delayMs > 0) {
          setTimeout(run, delayMs);
        } else {
          process.nextTick(run);
        }
      });
    }
    
    run();
  });
  
  // Handle callback mode - use once() to guarantee single invocation
  if (typeof callback === 'function') {
    const done = once(callback);
    promise.then(
      result => done(null, result),
      error => done(error)
    );
  }
  
  return promise;
}

module.exports = { retry };
