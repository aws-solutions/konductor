'use strict';

/**
 * Fake payment gateway. `delayMs` is how long a charge takes; `fail` gets the request and returns an error message
 * for a charge to decline, or null. A charge whose `signal` aborts stops and rejects.
 */
function createFakePayments({ delayMs = 5, fail = () => null } = {}) {
  const charges = [];
  return {
    charges,
    charge({ eventId, userId, amountCents, signal }) {
      return new Promise((resolve, reject) => {
        const timer = setTimeout(() => {
          const reason = fail({ eventId, userId });
          if (reason) return reject(new Error(reason));
          charges.push({ eventId, userId, amountCents });
          resolve({ chargeId: `c-${charges.length}` });
        }, delayMs);
        signal?.addEventListener('abort', () => { clearTimeout(timer); reject(new Error('charge stopped')); }, { once: true });
      });
    },
  };
}

module.exports = { createFakePayments };
