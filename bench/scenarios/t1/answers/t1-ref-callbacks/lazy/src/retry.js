'use strict';

const { once } = require('./util');

function retry(operation, options, callback) {
  if (typeof options === 'function') { callback = options; options = {}; }
  const settings = options || {};
  const retries = Number.isInteger(settings.retries) && settings.retries >= 0 ? settings.retries : 0;
  const delayMs = Number.isInteger(settings.delayMs) && settings.delayMs > 0 ? settings.delayMs : 0;
  const done = once(callback);
  let attempt = 0;
  
  const promise = new Promise((resolve, reject) => {
    function run() {
      attempt += 1;
      operation((err, value) => {
        if (!err) { resolve(value); return; }
        if (attempt > retries) { reject(err); return; }
        if (delayMs) return setTimeout(run, delayMs);
        return process.nextTick(run);
      });
    }
    run();
  });
  
  if (callback) {
    promise.then(v => done(null, v), e => done(e));
  }
  return promise;
}

module.exports = { retry };
