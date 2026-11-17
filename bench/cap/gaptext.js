// SPDX-License-Identifier: Apache-2.0
// Copied from Michael Lin's scripts/bench/lib/report-text.js (pull request #263, commit 33b385f9), same repository and Apache-2.0 licence. Only the two formatters the copied rules print with.
/**
 * How the copied label, verdict and pass rules print a gap and an interval. Pure.
 */
'use strict';

/**
 * A gap or interval end to 2 decimals with its sign, or to 2 significant digits when it is not 0 but would print as 0
 * (+0.00 or -0.00): a label read from such an end then shows the figure that decided it. `n/a` for no number.
 */
const formatGap = (value) => {
  if (typeof value !== 'number') return 'n/a';
  const shown =
    value !== 0 && Number(value.toFixed(2)) === 0
      ? value.toPrecision(2)
      : value.toFixed(2);
  return `${value >= 0 ? '+' : ''}${shown}`;
};

/** `[low, high]` with each end printed by `format` (default formatGap), or `n/a` when there is no interval. */
const formatInterval = (interval, format = formatGap) =>
  Array.isArray(interval)
    ? `[${format(interval[0])}, ${format(interval[1])}]`
    : 'n/a';

module.exports = { formatGap, formatInterval };
