'use strict';

const { once } = require('./util');

function retry(operation, options, callback) {
  const settings = options || {};
  const retries = Number.isInteger(settings.retries) && settings.retries >= 0 ? settings.retries : 0;
  const delayMs = Number.isInteger(settings.delayMs) && settings.delayMs > 0 ? settings.delayMs : 0;
  const done = once(callback);
  let attempt = 0;
  function run() {
    attempt += 1;
    operation((err, value) => {
      if (!err) return done(null, value);
      if (attempt > retries) return done(err);
      if (delayMs) return setTimeout(run, delayMs);
      return process.nextTick(run);
    });
  }
  run();
}

module.exports = { retry };
