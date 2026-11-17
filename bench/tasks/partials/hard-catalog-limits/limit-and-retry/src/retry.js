'use strict';

const { CatalogError } = require('./errors');

const TRANSIENT = new Set(['BUSY', 'TIMEOUT']);

/**
 * Calls `fn` up to `attempts` times while it fails with a transient supplier code, waiting `backoffMs[i]` through
 * `sleep` before attempt i + 2. Other errors are thrown at once. When every attempt failed, rejects with
 * SUPPLIER_UNAVAILABLE naming the last code.
 */
async function withRetry(fn, { attempts, backoffMs, sleep }) {
  let last;
  for (let i = 0; i < attempts; i++) {
    if (i > 0) await sleep(backoffMs[Math.min(i - 1, backoffMs.length - 1)]);
    try {
      return await fn();
    } catch (err) {
      if (!TRANSIENT.has(err.code)) throw err;
      last = err;
    }
  }
  throw new CatalogError('SUPPLIER_UNAVAILABLE', `supplier unavailable after ${attempts} attempts (last: ${last.code})`);
}

module.exports = { withRetry };
