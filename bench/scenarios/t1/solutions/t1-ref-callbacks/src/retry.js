'use strict';

const { withCallback } = require('./bridge');

function operationResult(operation) {
  return new Promise((resolve, reject) => {
    let settled = false;
    const finish = (err, value) => {
      if (settled) return;
      settled = true;
      if (err) reject(err); else resolve(value);
    };
    let result;
    try { result = operation(finish); } catch (err) { finish(err); return; }
    if (result && typeof result.then === 'function') result.then((value) => finish(null, value), finish);
    else if (operation.length === 0 && result !== undefined) finish(null, result);
  });
}

async function retryAsync(operation, settings) {
  const options = settings || {};
  const retries = Number.isInteger(options.retries) && options.retries >= 0 ? options.retries : 0;
  const delayMs = Number.isInteger(options.delayMs) && options.delayMs > 0 ? options.delayMs : 0;
  for (let attempt = 0; attempt <= retries; attempt += 1) {
    try {
      return await operationResult(operation);
    } catch (err) {
      if (attempt === retries) throw err;
      if (delayMs) await new Promise((resolve) => setTimeout(resolve, delayMs));
    }
  }
  throw new Error('retry did not run');
}

function retry(operation, options, callback) {
  if (typeof options === 'function') { callback = options; options = {}; }
  return withCallback(retryAsync(operation, options), callback);
}

module.exports = { retry };
