// SPDX-License-Identifier: Apache-2.0
/**
 * A synthetic judge roster for tests: placeholder models and made-up family tags. No real model
 * name appears in the benchmark code, its default config or its fixtures.
 */
const seat = (n) => ({
  seat: `seat-${n}`,
  family: `family-${n}`,
  plugin: 'replay',
  model: `<provider>/<model-${n}>`,
});

/** A valid roster of `count` seats with distinct families. */
const roster = (count = 3) => Array.from({ length: count }, (_, i) => seat(i + 1));

module.exports = { seat, roster };
