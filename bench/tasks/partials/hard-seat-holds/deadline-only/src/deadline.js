'use strict';

const { BookingError } = require('./errors');

/**
 * Runs `start(signal)` and settles with its result, unless `timeoutMs` passes first (PAYMENT_TIMEOUT) or `callerSignal`
 * aborts first (ABORTED). In both of those cases the signal given to `start` is aborted so the callee can stop.
 * `onError(err)` maps a rejection of `start` to the error to reject with. The timer and the listener are always removed.
 */
function runWithDeadline(start, { timeoutMs, callerSignal, onError }) {
  const controller = new AbortController();
  return new Promise((resolve, reject) => {
    let settled = false;
    const finish = (settle, value) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      callerSignal?.removeEventListener('abort', onAbort);
      settle(value);
    };
    const stop = (error) => { controller.abort(); finish(reject, error); };
    const onAbort = () => stop(new BookingError('ABORTED', 'the caller cancelled the booking'));
    const timer = setTimeout(() => stop(new BookingError('PAYMENT_TIMEOUT', `no payment answer within ${timeoutMs} ms`)), timeoutMs);
    callerSignal?.addEventListener('abort', onAbort, { once: true });
    // The caller may have aborted while the seat was being taken, before this listener existed.
    if (callerSignal?.aborted) return onAbort();
    Promise.resolve()
      .then(() => start(controller.signal))
      .then((value) => finish(resolve, value), (err) => finish(reject, onError(err)));
  });
}

module.exports = { runWithDeadline };
