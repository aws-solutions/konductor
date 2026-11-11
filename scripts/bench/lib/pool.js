// SPDX-License-Identifier: Apache-2.0
/**
 * Bounded worker pool. The caller passes the width of each seat. `createPools({ widths, defaultWidth })`
 * returns run(seat, items, work): at most widths[seat] calls of work(item, index) run at once in that run() call.
 * Seats run side by side, each inside its own width. The width holds per run() call, so run one run() at a time per
 * seat: two run() calls for one seat at once each get the full width.
 *
 * run() resolves to one entry per item in item order, { value } or { error }, so one failed item does not hide the rest.
 * An error with `fatal` set (a credential failure, a spend STOP, a systemic failure) stops every seat from starting
 * more items; calls already running finish, and run() then rejects with the first fatal error instead of returning.
 * The results of that run() call are not returned, so work that must be kept is stored by `work` itself.
 * Make one pools object per job: once a fatal error is seen, it stays stopped.
 */
'use strict';

const isValidWidth = (width) => Number.isInteger(width) && width >= 1;

function createPools({ widths = {}, defaultWidth = 1 } = {}) {
  if (!isValidWidth(defaultWidth))
    throw new TypeError('defaultWidth must be a whole number, 1 or more');
  for (const [seat, seatWidth] of Object.entries(widths))
    if (!isValidWidth(seatWidth))
      throw new TypeError(
        `width for seat ${seat} must be a whole number, 1 or more`,
      );
  let fatal = null;
  const width = (seat) =>
    Object.hasOwn(widths, seat) ? widths[seat] : defaultWidth;

  async function run(seat, items, work) {
    const results = new Array(items.length);
    let nextIndex = 0;
    const runWorker = async () => {
      while (!fatal && nextIndex < items.length) {
        const i = nextIndex++;
        try {
          results[i] = { value: await work(items[i], i) };
        } catch (error) {
          if (error && error.fatal && !fatal) fatal = error;
          results[i] = { error };
        }
      }
    };
    await Promise.all(
      Array.from({ length: Math.min(width(seat), items.length) }, runWorker),
    );
    if (fatal) throw fatal;
    return results;
  }
  return { run, width };
}

/** One seat: map `items` through work with at most `width` calls at once. */
const pool = (items, width, work) =>
  createPools({ defaultWidth: width }).run('', items, work);

module.exports = { createPools, pool };
