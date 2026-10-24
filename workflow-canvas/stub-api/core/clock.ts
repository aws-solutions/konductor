// SPDX-License-Identifier: Apache-2.0

/** The only source of time for the core, so tests can move it by hand. */
export interface Clock {
  /** Milliseconds since the Unix epoch. */
  now(): number;
}
