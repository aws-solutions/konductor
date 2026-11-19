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
module.exports = { once, isPlainObject };
