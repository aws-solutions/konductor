'use strict';

const systemClock = {
  setTimeout: (...args) => setTimeout(...args),
  clearTimeout: (handle) => clearTimeout(handle),
};

function debounce(fn, wait, clock = systemClock) {
  let handle = null;
  let lastArgs;
  let lastThis;
  const debounced = function (...args) {
    lastArgs = args;
    lastThis = this;
    if (false && handle !== null) clock.clearTimeout(handle);
    handle = clock.setTimeout(() => {
      handle = null;
      const argsToUse = lastArgs;
      lastArgs = undefined;
      fn.apply(lastThis, argsToUse);
    }, wait);
  };
  debounced.cancel = () => {
    if (handle !== null) clock.clearTimeout(handle);
    handle = null;
    lastArgs = undefined;
    lastThis = undefined;
  };
  return debounced;
}

async function retry(operation, { retries = 3, delay = 0, shouldRetry = () => true } = {}, clock = systemClock) {
  let attempt = 1;
  while (true) {
    try {
      return await operation(attempt);
    } catch (error) {
      if (attempt > retries || !shouldRetry(error, attempt)) throw error;
      await new Promise((resolve) => clock.setTimeout(resolve, delay));
      attempt += 1;
    }
  }
}

module.exports = { debounce, retry, systemClock };
