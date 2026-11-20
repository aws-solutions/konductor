'use strict';

function once(fn) {
  let used = false;
  return (...args) => {
    if (used) return;
    used = true;
    return fn(...args);
  };
}

function isPlainObject(value) { return value !== null && typeof value === 'object' && !Array.isArray(value); }

/**
 * Wraps an async function to support both callback and promise interfaces.
 * Callback runs exactly once. In callback mode, promise rejection is caught
 * to prevent unhandled rejection warnings.
 */
function promisify(fn) {
  return function wrapper(...args) {
    // Find callback argument (last arg if it's a function)
    const maybeCallback = args[args.length - 1];
    const hasCallback = typeof maybeCallback === 'function';
    const callback = hasCallback ? maybeCallback : null;
    const fnArgs = hasCallback ? args.slice(0, -1) : args;
    
    // Create the promise
    const promise = Promise.resolve().then(() => fn.apply(this, fnArgs));
    
    if (callback) {
      // Attach callback handler - this ensures the callback runs exactly once
      // and prevents unhandled rejections
      promise.then(
        result => callback(null, result),
        error => callback(error)
      );
    }
    
    return promise;
  };
}

module.exports = { once, isPlainObject, promisify };
